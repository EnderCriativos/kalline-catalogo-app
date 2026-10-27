// Shared JSON-only review model. No photo bytes, credentials or printed annotations.
(() => {
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
  const text = (value, max, multiline = false) => typeof value === 'string' && value.length <= max && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f\u2028\u2029]/u).test(value);
  const pieceText = p => [p.name.trim(), p.code.trim()].filter(Boolean).join(' - ');
  const printed = page => page.pieces.filter(p => pieceText(p) || p.size.trim());
  function validate(page) {
    if (page.pieces.length > 8) throw Error('Máximo de oito peças por página.');
    const ids = new Set();
    for (const p of page.pieces) {
      if (!text(p.name, 160) || !text(p.code, 80) || !text(p.size, 80) ||
          (p.id !== undefined && (!id(p.id) || ids.has(p.id)))) throw Error('Peça inválida ou identificador repetido.');
      if (p.id) ids.add(p.id);
    }
    if (page.comments === undefined) return;
    if (!Array.isArray(page.comments) || page.comments.length > 100) throw Error('Comentários inválidos: máximo de cem por página.');
    const notes = new Set();
    for (const c of page.comments) {
      if (!c || Object.keys(c).some(k => !['id','pageId','x','y','text','resolved','author','createdAt','updatedAt','layout'].includes(k)) ||
          !id(c.id) || notes.has(c.id) || c.pageId !== page.id || !Number.isFinite(c.x) || !Number.isFinite(c.y) ||
          c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1 || !text(c.text, 2000, true) || !c.text.trim() ||
          typeof c.resolved !== 'boolean' || !c.author || Object.keys(c.author).some(k => !['id','name','kind'].includes(k)) ||
          !text(c.author.id, 160) || !text(c.author.name, 160) || !['local','authenticated'].includes(c.author.kind) ||
          typeof c.createdAt !== 'string' || typeof c.updatedAt !== 'string' || c.createdAt.length>40 || c.updatedAt.length>40 || !Number.isFinite(Date.parse(c.createdAt)) || !Number.isFinite(Date.parse(c.updatedAt)) ||
          !['look3','look3_right','2col','3col','quad4','estourada'].includes(c.layout)) throw Error('Marcação inválida.');
      notes.add(c.id);
    }
  }
  function normalize(plan) {
    for (const page of plan) page.pieces.forEach((p, i) => { if (!p.id) p.id = 'piece_' + page.id + '_' + i; });
    return plan;
  }
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  // Reserve footer area; never move the photographic grid to accommodate labels.
  const layout = page => {
    const n = printed(page).length;
    return { count:n, compact:n >= 3, max:4, top:n <= 1 ? 781.1 : n === 2 ? 774 : 768,
      step:n >= 3 ? 15 : 17, height:n >= 3 ? 14 : 24, font:n >= 3 ? 9 : 10 };
  };
  globalThis.KallineReview = Object.freeze({ validate, normalize, printed, pieceText, escape, layout });
})();
