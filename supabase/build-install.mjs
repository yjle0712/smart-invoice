// Régénère INSTALLATION_COMPLETE.sql = nettoyage + toutes les migrations dans l'ordre.
// Usage : node supabase/build-install.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(join(dir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
let out = readFileSync(join(dir, "install-header.sql"), "utf8");
for (const f of files) out += `\n-- >>>>>>>>>> ${f}\n` + readFileSync(join(dir, "migrations", f), "utf8");
out += `
-- >>>>>>>>>> Comptes existants : création de leur profil
insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

select 'Smart Invoice : installation terminée avec succès' as resultat;
`;
writeFileSync(join(dir, "INSTALLATION_COMPLETE.sql"), out);
console.log(`INSTALLATION_COMPLETE.sql : ${files.length} migrations`);
