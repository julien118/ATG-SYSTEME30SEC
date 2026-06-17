// =============================================================
// Décodage des entités HTML — utilitaire pur (client + serveur)
// =============================================================
// Costructor renvoie certains libellés d'articles avec des entités HTML
// (« > » encodé en « &gt; », idem &amp; &lt; &quot; &#39;...). Sans décodage,
// un « &gt; » s'affichait littéralement dans la proposition technique, les
// métrés et le récapitulatif (cf. section « Points singuliers »).
//
// Fonction PURE, sans aucune dépendance serveur : utilisable dans les
// composants client (devis-editeur) ET serveur (récap) pour décoder À
// L'AFFICHAGE uniquement. La donnée stockée et le payload poussé vers
// Costructor restent inchangés. Idempotent : décoder un texte déjà propre
// ne change rien.
//
// L'entité &amp; est traitée en DERNIER pour ne pas sur-décoder une séquence
// comme &amp;gt; (qui doit redonner &gt;, pas >). Couvre les entités
// numériques décimales (&#39;) et hexadécimales (&#x27;).
export function decoderEntitesHtml(s: string): string {
  if (!s) return s
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
}
