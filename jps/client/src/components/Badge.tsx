const TONES: Record<string, { tone: string; soft: string }> = {
  // Positif / actif / réglé
  ACTIF: { tone: "#059669", soft: "#ecfdf5" },
  PAYE: { tone: "#059669", soft: "#ecfdf5" },
  PAYEE: { tone: "#059669", soft: "#ecfdf5" },
  EMISE: { tone: "#059669", soft: "#ecfdf5" },
  COMPTANT: { tone: "#059669", soft: "#ecfdf5" },
  ENTREE: { tone: "#059669", soft: "#ecfdf5" },
  // Attention / en cours
  BROUILLON: { tone: "#b45309", soft: "#fffbeb" },
  ATTENTE_BDC: { tone: "#b45309", soft: "#fffbeb" },
  A_COMPTABILISER: { tone: "#b45309", soft: "#fffbeb" },
  PARTIELLEMENT_PAYEE: { tone: "#b45309", soft: "#fffbeb" },
  CREDIT: { tone: "#b45309", soft: "#fffbeb" },
  // Négatif / arrêté / non réglé
  NON_PAYE: { tone: "#be123c", soft: "#fff1f2" },
  ANNULEE: { tone: "#be123c", soft: "#fff1f2" },
  RESILIE: { tone: "#be123c", soft: "#fff1f2" },
  TERMINE: { tone: "#64748b", soft: "#f1f5f9" },
  SORTIE: { tone: "#be123c", soft: "#fff1f2" },
};

const DEFAULT_TONE = { tone: "#475569", soft: "#f1f5f9" };

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span>—</span>;
  const { tone, soft } = TONES[value] ?? DEFAULT_TONE;
  const label = value.replaceAll("_", " ");
  return (
    <span className="badge" style={{ ["--tone" as string]: tone, ["--tone-soft" as string]: soft }}>
      {label}
    </span>
  );
}
