import { describe, expect, it } from "vitest";
import { amountToFrenchWords, arreteSentence, integerToFrench } from "../words";

describe("integerToFrench", () => {
  const cases: [number, string][] = [
    [0, "zéro"],
    [1, "un"],
    [16, "seize"],
    [17, "dix-sept"],
    [20, "vingt"],
    [21, "vingt et un"],
    [22, "vingt-deux"],
    [31, "trente et un"],
    [61, "soixante et un"],
    [70, "soixante-dix"],
    [71, "soixante et onze"],
    [72, "soixante-douze"],
    [77, "soixante-dix-sept"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [90, "quatre-vingt-dix"],
    [91, "quatre-vingt-onze"],
    [99, "quatre-vingt-dix-neuf"],
    [100, "cent"],
    [101, "cent un"],
    [180, "cent quatre-vingts"],
    [200, "deux cents"],
    [201, "deux cent un"],
    [999, "neuf cent quatre-vingt-dix-neuf"],
    [1000, "mille"],
    [1001, "mille un"],
    [1080, "mille quatre-vingts"],
    [2000, "deux mille"],
    [4500, "quatre mille cinq cents"],
    [80000, "quatre-vingt mille"],
    [200000, "deux cent mille"],
    [201000, "deux cent un mille"],
    [1_000_000, "un million"],
    [2_000_000, "deux millions"],
    [80_000_000, "quatre-vingts millions"],
    [200_000_000, "deux cents millions"],
    [1_000_001, "un million un"],
    [1_000_000_000, "un milliard"],
    [3_200_450_071, "trois milliards deux cents millions quatre cent cinquante mille soixante et onze"],
  ];
  for (const [n, expected] of cases) {
    it(`${n}`, () => expect(integerToFrench(n)).toBe(expected));
  }
});

describe("amountToFrenchWords", () => {
  it("exemple du cahier des charges", () => {
    expect(amountToFrenchWords(450000)).toBe("QUATRE MILLE CINQ CENTS DIRHAMS");
  });
  it("garde les centimes (l'ancien code les supprimait)", () => {
    expect(amountToFrenchWords(123456)).toBe("MILLE DEUX CENT TRENTE-QUATRE DIRHAMS ET CINQUANTE-SIX CENTIMES");
  });
  it("singulier", () => {
    expect(amountToFrenchWords(100)).toBe("UN DIRHAM");
    expect(amountToFrenchWords(101)).toBe("UN DIRHAM ET UN CENTIME");
  });
  it("centimes seuls", () => expect(amountToFrenchWords(75)).toBe("SOIXANTE-QUINZE CENTIMES"));
  it("zéro", () => expect(amountToFrenchWords(0)).toBe("ZÉRO DIRHAM"));
  it("« de » après million", () => {
    expect(amountToFrenchWords(100_000_000)).toBe("UN MILLION DE DIRHAMS");
    expect(amountToFrenchWords(100_000_050)).toBe("UN MILLION DE DIRHAMS ET CINQUANTE CENTIMES");
    expect(amountToFrenchWords(100_100_000)).toBe("UN MILLION MILLE DIRHAMS");
  });
  it("phrase complète", () => {
    expect(arreteSentence(450000)).toBe(
      "ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE : QUATRE MILLE CINQ CENTS DIRHAMS",
    );
  });
  it("refuse les montants invalides", () => {
    expect(() => amountToFrenchWords(-1)).toThrow();
    expect(() => amountToFrenchWords(1.5)).toThrow();
  });
});
