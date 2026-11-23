// Converts every citation style the models produce into plain [n] markers, so citations can be
// checked, renumbered and shown as links. gpt-oss in particular often writes 【4】 or 【4†L1-L3】.
//   【4】 【4†source】 ［4］ 〔4〕  ->  [4]
//   [2, 7]  [2;7]               ->  [2][7]
export function normalizeCitations(text) {
  return String(text ?? '')
    .replace(/[【［〔]\s*(\d+)[^】］〕\]\n]*[】］〕\]]/g, '[$1]')
    .replace(/\[\s*(\d+(?:\s*[,;]\s*\d+)+)\s*\]/g, (_, list) =>
      list
        .split(/\s*[,;]\s*/)
        .map((n) => `[${n}]`)
        .join(''),
    )
    .replace(/[ \t]{2,}(\[\d+\])/g, ' $1') // collapse odd spacing before a citation
    .replace(/(\[\d+\])[ \t]+([.,;:])/g, '$1$2'); // "claim [2] ." -> "claim [2]."
}
