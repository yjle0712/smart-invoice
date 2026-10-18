/**
 * Import d'un PDF de factures dans le Journal TVA (navigateur).
 *
 * 1. empreinte SHA-256 : un fichier déjà importé est signalé ; un import interrompu reprend ;
 * 2. copie du PDF dans le stockage privé (aperçu des pages source plus tard) ;
 * 3. lecture du texte par lots de pages, OCR des pages sans texte ;
 * 4. découpage en factures et extraction des champs (module domain/extraction) ;
 * 5. enregistrement des factures « à contrôler » (jamais validées automatiquement) ;
 *    les doublons sont enregistrés « rejetés » avec le motif, pour rester traçables.
 */
import { supabase, must } from "./supabase";
import type { Company, Party, PdfImport, VatEntryKind } from "./types";
import { readPageText, type PdfDoc } from "./pdftext";
import { meaningfulChars, type PageText } from "@/domain/extraction/layout";
import { extractInvoices, type ExtractedInvoice, type Field } from "@/domain/extraction/extract";
import { clearCachedPages, loadCachedPages, saveCachedPages, sessionFiles, sha256 } from "./pagecache";

export interface ImportProgress {
  phase: "hash" | "upload" | "read" | "extract" | "save" | "done";
  pagesDone: number;
  pageCount: number;
  ocrPages: number;
  invoicesDetected: number;
  errors: string[];
  message?: string;
}

export interface ImportResult {
  importId: string;
  invoices: number;
  toReview: number;
  duplicates: number;
  ocrPages: number;
  pageCount: number;
  errors: string[];
}

const MAX_UPLOAD = 45 * 1024 * 1024;
const OCR_MIN_CHARS = 25;

export class AlreadyImportedError extends Error {
  constructor(public existing: PdfImport) {
    super(`Ce fichier a déjà été importé le ${new Date(existing.created_at).toLocaleDateString("fr-MA")} (${existing.invoices_found} factures).`);
  }
}

async function openPdf(buf: ArrayBuffer) {
  const { pdfjs } = await import("./pdfjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

const conf = (f: Field<unknown>) => f.confidence;

function toRow(inv: ExtractedInvoice, company: Company, imp: PdfImport, fileName: string, parties: Party[]) {
  const purchase = inv.kind === "purchase";
  const name = purchase ? inv.issuerName : inv.clientName;
  const ice = purchase ? inv.issuerIce : inv.clientIce;
  const iff = purchase ? inv.issuerIf : inv.clientIf;
  const party = ice.value ? parties.find((p) => p.ice === ice.value) : undefined;
  return {
    company_id: company.id,
    kind: inv.kind,
    status: "to_review" as "to_review" | "rejected",
    source: "import" as const,
    import_id: imp.id,
    source_file: fileName,
    page_from: inv.pageFrom,
    page_to: inv.pageTo,
    invoice_number: inv.number.value,
    invoice_date: inv.date.value,
    party_id: party?.id ?? null,
    party_name: name.value,
    party_ice: ice.value,
    party_if: iff.value ?? party?.if_number ?? null,
    goods_nature: inv.goodsNature.value,
    total_ht: inv.ht.value,
    total_vat: inv.vat.value,
    total_ttc: inv.ttc.value,
    vat_rate_bp: inv.vatRateBp.value,
    rates: inv.rates.length > 1 ? inv.rates.map((r) => ({ rate_bp: r.rateBp, ht: r.ht, vat: r.vat, ttc: r.ttc })) : [],
    rubrique: purchase ? company.default_purchase_rubrique : null,
    confidence: {
      invoice_number: conf(inv.number), invoice_date: conf(inv.date), party_name: conf(name), party_ice: conf(ice), party_if: conf(iff),
      goods_nature: conf(inv.goodsNature), total_ht: conf(inv.ht), total_vat: conf(inv.vat), total_ttc: conf(inv.ttc), vat_rate_bp: conf(inv.vatRateBp),
      kind: inv.kindReason, ocr: inv.ocr ? "oui" : "non",
      ...(inv.suggestions.ht !== undefined ? { suggestion_ht: String(inv.suggestions.ht) } : {}),
      ...(inv.suggestions.vat !== undefined ? { suggestion_vat: String(inv.suggestions.vat) } : {}),
      ...(inv.suggestions.ttc !== undefined ? { suggestion_ttc: String(inv.suggestions.ttc) } : {}),
    },
    issues: inv.issues,
    checks: inv.checks,
  };
}

export async function importPdf(
  file: File,
  opts: { company: Company; defaultKind: VatEntryKind; signal?: AbortSignal; onProgress: (p: ImportProgress) => void; allowReimport?: boolean },
): Promise<ImportResult> {
  const { company, defaultKind, signal, onProgress } = opts;
  const prog: ImportProgress = { phase: "hash", pagesDone: 0, pageCount: 0, ocrPages: 0, invoicesDetected: 0, errors: [] };
  const emit = (p: Partial<ImportProgress>) => onProgress(Object.assign(prog, p));
  emit({});

  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error("Seuls les fichiers PDF sont acceptés.");
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  sessionFiles.set(hash, buf);

  // ----- Import existant ? -----
  const existing = (must(await supabase.from("pdf_imports").select("*").eq("company_id", company.id).eq("file_hash", hash).maybeSingle())) as PdfImport | null;
  if (existing && existing.status === "done" && !opts.allowReimport) throw new AlreadyImportedError(existing);

  const { doc, close } = await openPdf(buf);
  try {
    const pageCount = doc.numPages;
    emit({ phase: "upload", pageCount });

    // ----- Stockage du PDF source (si la taille le permet) -----
    let storagePath: string | null = existing?.storage_path ?? null;
    if (!storagePath && file.size <= MAX_UPLOAD) {
      const path = `${company.id}/imports/${hash}.pdf`;
      const up = await supabase.storage.from("company-assets").upload(path, file, { contentType: "application/pdf", upsert: true });
      if (up.error) prog.errors.push(`PDF source non sauvegardé (${up.error.message}) : l'aperçu des pages ne sera disponible que pendant cette session.`);
      else storagePath = path;
    } else if (!storagePath) {
      prog.errors.push("Fichier de plus de 45 Mo : le PDF source n'est pas sauvegardé, l'aperçu des pages sera disponible pendant cette session seulement.");
    }

    let imp: PdfImport;
    if (existing) {
      imp = must(await supabase.from("pdf_imports").update({ status: "processing", page_count: pageCount, storage_path: storagePath, default_kind: defaultKind, error_message: null })
        .eq("id", existing.id).select().single()) as PdfImport;
      if (existing.status === "done") {
        // Réimport explicite : on retire les écritures non validées de l'import précédent
        must(await supabase.from("vat_entries").delete().eq("import_id", existing.id).neq("status", "validated"));
      }
    } else {
      imp = must(await supabase.from("pdf_imports").insert({
        company_id: company.id, file_name: file.name, file_hash: hash, file_size: file.size, storage_path: storagePath,
        default_kind: defaultKind, page_count: pageCount,
      }).select().single()) as PdfImport;
    }

    // ----- Lecture des pages (reprise à partir du cache local) -----
    const cached = (await loadCachedPages(hash)).filter((p) => p.page >= 1 && p.page <= pageCount);
    const pages: PageText[] = [...cached].sort((a, b) => a.page - b.page);
    const done = new Set(pages.map((p) => p.page));
    let ocrCount = pages.filter((p) => p.ocr).length;
    emit({ phase: "read", pagesDone: done.size, ocrPages: ocrCount, message: done.size ? `Reprise : ${done.size} pages déjà lues.` : undefined });

    const BATCH = 8;
    for (let start = 1; start <= pageCount; start += BATCH) {
      if (signal?.aborted) throw new DOMException("Import interrompu", "AbortError");
      const end = Math.min(pageCount, start + BATCH - 1);
      for (let n = start; n <= end; n++) {
        if (done.has(n)) continue;
        try {
          let p = await readPageText(doc as unknown as PdfDoc, n);
          if (meaningfulChars(p.lines) < OCR_MIN_CHARS) {
            emit({ message: `OCR de la page ${n}…` });
            const { ocrPdfPage } = await import("./ocr");
            try {
              p = await ocrPdfPage(doc, n);
              ocrCount++;
            } catch (e) {
              prog.errors.push(`Page ${n} : ${(e as Error).message}`);
            }
          }
          if (p.lines.length === 0) prog.errors.push(`Page ${n} : aucun texte lisible (page blanche ou scan illisible).`);
          pages.push(p);
          done.add(n);
        } catch (e) {
          prog.errors.push(`Page ${n} illisible : ${(e as Error).message}`);
          pages.push({ page: n, lines: [] });
          done.add(n);
        }
      }
      pages.sort((a, b) => a.page - b.page);
      // Estimation en direct du nombre de factures (même moteur que l'extraction finale)
      const detected = extractInvoices(pages, { defaultKind, company: { name: company.legal_name, ice: company.ice } }).length;
      emit({ pagesDone: done.size, ocrPages: ocrCount, invoicesDetected: detected, message: undefined });
      await saveCachedPages(hash, pages);
      await supabase.from("pdf_imports").update({ pages_done: done.size, ocr_pages: ocrCount }).eq("id", imp.id);
      await new Promise((r) => setTimeout(r, 0));
    }

    // ----- Extraction -----
    emit({ phase: "extract" });
    const parties = must(await supabase.from("parties").select("*").eq("company_id", company.id)) as Party[];
    const invoices = extractInvoices(pages, {
      defaultKind,
      company: { name: company.legal_name, ice: company.ice },
      vatRatesBp: company.vat_rates_bp,
      knownParties: parties.map((p) => ({ id: p.id, name: p.name, ice: p.ice, if_number: p.if_number, kind: p.kind })),
    });

    // Doublons avec la base (écritures existantes + factures de vente de Smart Invoice)
    const keys = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const rows = must(await supabase.from("vat_entries").select("dedup_key").eq("company_id", company.id).neq("status", "rejected").eq("archived", false)
        .not("dedup_key", "is", null).range(from, from + 999)) as { dedup_key: string }[];
      rows.forEach((r) => keys.add(r.dedup_key));
      if (rows.length < 1000) break;
    }
    const ownNumbers = new Set(
      (must(await supabase.from("invoices").select("number").eq("company_id", company.id).not("number", "is", null).limit(50000)) as { number: string }[])
        .map((r) => r.number.replace(/\W+/g, "").toUpperCase()),
    );

    // ----- Enregistrement -----
    emit({ phase: "save" });
    let duplicates = 0;
    const rows = invoices.map((inv) => {
      const row = toRow(inv, company, imp, file.name, parties);
      const dupInFile = inv.issues.some((i) => i.startsWith("Doublon"));
      const key = row.invoice_number && (row.party_ice || row.party_name)
        ? `${row.kind}|${(row.party_ice ?? row.party_name ?? "").toLowerCase().replace(/\W+/g, "")}|${row.invoice_number.replace(/\W+/g, "").toUpperCase()}` : null;
      let dupReason: string | null = dupInFile ? "Doublon dans le fichier." : null;
      if (!dupReason && key && keys.has(key)) dupReason = "Doublon : cette facture est déjà dans le journal.";
      if (!dupReason && row.kind === "sale" && row.invoice_number && ownNumbers.has(row.invoice_number.replace(/\W+/g, "").toUpperCase())) {
        dupReason = "Doublon : facture de vente déjà émise dans Smart Invoice (elle figure déjà au journal des ventes).";
      }
      if (key && !dupReason) keys.add(key);
      if (dupReason) {
        duplicates++;
        return { ...row, status: "rejected" as "to_review" | "rejected", issues: [...row.issues.filter((i) => !i.startsWith("Doublon")), dupReason] };
      }
      return row;
    });
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const res = await supabase.from("vat_entries").insert(chunk);
      if (res.error?.code === "23505") {
        // Un doublon non détecté côté navigateur : on enregistre ligne par ligne.
        for (const r of chunk) {
          const one = await supabase.from("vat_entries").insert(r);
          if (one.error?.code === "23505") {
            duplicates++;
            r.status = "rejected";
            r.issues = [...r.issues, "Doublon : cette facture est déjà dans le journal."];
            must(await supabase.from("vat_entries").insert(r));
          } else if (one.error) throw new Error(one.error.message);
        }
      } else if (res.error) throw new Error(res.error.message);
      emit({ message: `Enregistrement ${Math.min(rows.length, i + 200)} / ${rows.length}` });
    }

    const toReview = rows.filter((r) => r.status === "to_review").length;
    must(await supabase.from("pdf_imports").update({
      status: "done", pages_done: pageCount, ocr_pages: ocrCount, invoices_found: invoices.length, needs_review: toReview,
      error_count: prog.errors.length, finished_at: new Date().toISOString(), error_message: prog.errors.slice(0, 20).join("\n") || null,
    }).eq("id", imp.id));
    await clearCachedPages(hash);
    emit({ phase: "done", invoicesDetected: invoices.length });
    return { importId: imp.id, invoices: invoices.length, toReview, duplicates, ocrPages: ocrCount, pageCount, errors: prog.errors };
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      await supabase.from("pdf_imports").update({ status: "error", error_message: (e as Error).message }).eq("company_id", company.id).eq("file_hash", hash);
    }
    throw e;
  } finally {
    await close();
  }
}

/** Récupère les octets d'un PDF importé (session en cours, sinon stockage privé). */
export async function getImportPdf(imp: Pick<PdfImport, "file_hash" | "storage_path">): Promise<ArrayBuffer | null> {
  const local = sessionFiles.get(imp.file_hash);
  if (local) return local;
  if (!imp.storage_path) return null;
  const { data, error } = await supabase.storage.from("company-assets").download(imp.storage_path);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  sessionFiles.set(imp.file_hash, buf);
  return buf;
}
