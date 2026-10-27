// Review controls are separate from the printable page and from shared-version history.
let reviewDialog = null, reviewPageId = null, reviewMode = null, reviewDraft = null, reviewSelected = null;
const reviewUid = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
const reviewPage = () => pages.find(p => p.id === reviewPageId);
function closeReviewDialog() { if (reviewDialog?.open) reviewDialog.close(); reviewMode = null; }
function reviewElement(tag, text, parent) {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (parent) parent.append(el); return el;
}
function reviewButton(text, parent, action) {
  const el = reviewElement('button', text, parent); el.type = 'button'; el.addEventListener('click', action); return el;
}
function reviewField(label, value, parent, max, multiline = false) {
  const wrap = reviewElement('label', label, parent), input = reviewElement(multiline ? 'textarea' : 'input', undefined, wrap);
  input.value = value; input.maxLength = max; return input;
}
function openReviewDialog(pageId, title) {
  closeReviewDialog(); reviewPageId = pageId;
  if (!reviewDialog) {
    reviewDialog = document.createElement('dialog'); reviewDialog.className = 'review-dialog'; document.body.append(reviewDialog);
    reviewDialog.addEventListener('cancel', () => { reviewMode = null; });
  }
  reviewDialog.replaceChildren(); reviewDialog.setAttribute('aria-label', title);
  reviewElement('h2', title, reviewDialog); reviewElement('p', 'Página ' + (pages.findIndex(p => p.id === pageId) + 1) + ' · Look ' + reviewPage().lookNum, reviewDialog);
  return reviewDialog;
}
function commitPageReview(page, patch) {
  const previous={pages,undo:[...undoStack],redo:[...redoStack],snapshot:currentPlanSnapshot};
  try { pages=pages.map(p=>p===page?{...p,...patch}:p);saveState(); }
  catch(error){pages=previous.pages;undoStack=previous.undo;redoStack=previous.redo;currentPlanSnapshot=previous.snapshot;updateHistoryControls();throw Error('Não foi possível salvar localmente. A edição anterior foi preservada; exporte um JSON.');}
}
function openPiecesEditor(pageId) {
  const dialog = openReviewDialog(pageId, 'Peças e referências');
  KallineReview.normalize(pages); reviewDraft = structuredClone(reviewPage().pieces);
  reviewElement('p', 'Nome, referência e tamanhos são opcionais. Campos vazios não são impressos. Até quatro legendas cabem no rodapé; excesso ou texto longo bloqueiam a exportação até revisão.', dialog);
  const list = reviewElement('div', undefined, dialog); list.className = 'review-piece-list';
  const draw = () => {
    list.replaceChildren();
    reviewDraft.forEach((p, i) => {
      const box = reviewElement('fieldset', undefined, list); reviewElement('legend', 'Peça ' + (i + 1), box);
      for (const [key,label,max] of [['name','Nome',160],['code','Referência',80],['size','Tamanhos (opcional)',80]]) {
        const input = reviewField(label, p[key], box, max); input.setAttribute('aria-label', label + ' da peça ' + (i + 1));
        input.addEventListener('input', () => { p[key] = input.value; });
      }
      if (reviewDraft.length > 1) reviewButton('Remover peça ' + (i + 1), box, () => { reviewDraft.splice(i,1); draw(); });
    });
    add.disabled = reviewDraft.length >= 8;
  };
  const add = reviewButton('+ Adicionar peça', dialog, () => { if(reviewDraft.length<8){reviewDraft.push({id:reviewUid('piece'),name:'',code:'',size:''});draw();list.lastElementChild.querySelector('input').focus();} });
  const status = reviewElement('p', '', dialog); status.setAttribute('role','status');
  reviewButton('Salvar peças', dialog, () => {
    const page = reviewPage(), candidate = {...page,pieces:structuredClone(reviewDraft)};
    try { KallineReview.validate(candidate); commitPageReview(page,{pieces:candidate.pieces});closeReviewDialog();renderAllPages();showToast('Peças salvas. Confira o rodapé antes de exportar.'); }
    catch(error){status.textContent=error.message;}
  });
  reviewButton('Cancelar', dialog, closeReviewDialog); draw(); dialog.showModal();
}
async function reviewAuthor() {
  try {
    const user = await sharedVersionsPanel.client.connect();
    return {id:String(user.id),name:user.name,kind:'authenticated'};
  } catch { return {id:'local',name:'Revisor local (sem autenticação)',kind:'local'}; }
}
function openCommentsEditor(pageId, selectedId = null, point = null) {
  const dialog = openReviewDialog(pageId, 'Comentários da página'), page = reviewPage();
  const comment = (page.comments || []).find(c=>c.id===selectedId); reviewSelected = selectedId;
  reviewElement('p','Marcações de revisão: não aparecem no JSX nem na impressão. Coordenadas ficam presas à página, mesmo ao mover a página. Depois de trocar a grade, confira o ponto novamente.',dialog);
  const list = reviewElement('div', undefined, dialog); list.className='review-comments';
  if(!(page.comments||[]).length)reviewElement('p','Nenhum comentário nesta página.',list).className='review-comments-empty';
  for(const c of page.comments || []) {
    const card=reviewElement('article', undefined, list); card.className=c.id===selectedId?'review-selected':'';
    reviewButton((c.resolved?'✓ Resolvido · ':'● Aberto · ')+c.text,card,()=>openCommentsEditor(pageId,c.id));
    reviewElement('p',c.author.name+(c.author.kind==='local'?' · autoria local não verificada':' · identidade da sessão')+' · '+new Date(c.updatedAt).toLocaleString(),card);
    if(c.layout!==page.type) reviewElement('p','Grade alterada desde esta marcação. Confirme o ponto na página.',card).className='review-layout-warning';
  }
  if(!point && !comment) {
    reviewButton('+ Marcar ponto na página',dialog,()=>{
      closeReviewDialog();reviewMode=pageId;reviewPageId=pageId;renderAllPages();
      document.querySelector('[data-review-page="'+pageId+'"]').scrollIntoView({block:'center'});
      showToast('Toque no ponto da página para comentar. Esc cancela.');
    });
  } else {
    const input=reviewField('Observação',comment?.text || '',dialog,2000,true); input.rows=5;
    const resolvedLabel=reviewElement('label','Resolvido',dialog), resolved=reviewElement('input',undefined,resolvedLabel);resolved.type='checkbox';resolved.checked=comment?.resolved||false;
    const status=reviewElement('p','',dialog);status.setAttribute('role','status');
    const save=reviewButton('Salvar comentário',dialog,async()=>{
      save.disabled=true;
      try {
        if(!input.value.trim()) throw Error('Escreva uma observação.');
        const author=await reviewAuthor(), now=new Date().toISOString();
        // The dialog may have been closed while authentication was pending.
        if(!dialog.open || reviewPageId!==pageId) return;
        const item={...(comment||{id:reviewUid('comment'),pageId,x:point.x,y:point.y,createdAt:now,layout:page.type}),text:input.value.trim(),resolved:resolved.checked,author,updatedAt:now};
        const next=(page.comments||[]).filter(c=>c.id!==item.id); next.push(item);
        KallineReview.validate({...page,comments:next});commitPageReview(page,{comments:next});closeReviewDialog();renderAllPages();showToast('Comentário salvo na revisão.');
      }catch(error){status.textContent=error.message;}finally{save.disabled=false;}
    });
    if(comment){
      const remove=reviewButton('Excluir comentário',dialog,()=>{
        if(save.disabled)return;
        const current=reviewPage(),all=current?.comments||[],index=all.findIndex(c=>c.id===comment.id);
        if(index<0)return;
        if(!confirm('Excluir este comentário da revisão atual? Você poderá desfazer pelo histórico. As versões já salvas serão preservadas.'))return;
        try{
          const next=all.filter(c=>c.id!==comment.id);
          commitPageReview(current,{comments:next});
          reviewSelected=next[Math.min(index,next.length-1)]?.id||null;
          renderAllPages();openCommentsEditor(pageId,reviewSelected);
          showToast('Comentário excluído nesta revisão. Você pode desfazer pelo histórico. Clique em Salvar para guardar online.');
        }catch(error){status.textContent=error.message;}
      });
      remove.className='review-delete-comment';const icon=document.createElement('i');icon.dataset.lucide='trash-2';icon.setAttribute('aria-hidden','true');remove.prepend(icon,document.createTextNode(' '));
    }
    input.focus();
  }
  reviewButton('Fechar',dialog,closeReviewDialog); dialog.showModal();
  globalThis.lucide?.createIcons();
  if(comment) dialog.querySelector('textarea')?.focus();
}
function renderReviewOverlay(page) {
  const esc=KallineReview.escape;
  return `<div class="review-overlay ${reviewMode===page.id?'review-marking':''}" data-mark-page="${page.id}">${(page.comments||[]).map((c,i)=>`<button type="button" class="review-pin ${c.resolved?'resolved':''} ${c.id===reviewSelected?'selected':''}" style="left:${c.x*100}%;top:${c.y*100}%" data-comment="${c.id}" data-page-id="${page.id}" aria-label="Comentário ${i+1}: ${esc(c.text)}" title="${esc(c.text)}">${i+1}</button>`).join('')}</div>`;
}
document.addEventListener('click',event=>{
  const pin=event.target.closest('[data-comment]');
  if(pin){event.preventDefault();event.stopPropagation();openCommentsEditor(pin.dataset.pageId,pin.dataset.comment);return;}
  const overlay=event.target.closest('.review-marking'); if(!overlay || reviewMode!==overlay.dataset.markPage)return;
  const rect=overlay.getBoundingClientRect(), point={x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
  event.preventDefault();const pageId=reviewMode;reviewMode=null;renderAllPages();openCommentsEditor(pageId,null,point);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&reviewMode){reviewMode=null;renderAllPages();}});
function footerOverflow(page) {
  const printed=KallineReview.printed(page);if(printed.length>4)return 'Mais de quatro legendas no rodapé. Distribua as referências antes de exportar; nenhuma peça será omitida.';
  const node=document.querySelector('[data-review-page="'+page.id+'"]');if(!node)return '';
  const footer=node.querySelector('footer'), grid=node.querySelector('.page-photo-grid');
  if(!footer)return '';
  const pageBounds=node.getBoundingClientRect(), bounds=footer.getBoundingClientRect();
  if(bounds.bottom>pageBounds.bottom+1 || bounds.top<grid.getBoundingClientRect().bottom-1)return 'As legendas excedem a área do rodapé. Reduza o texto antes de exportar.';
  for(const row of footer.querySelectorAll('.footer-row-item')){
    const left=row.querySelector('.footer-left-group'),right=row.querySelector('.footer-right-group');
    if(left.scrollWidth>row.clientWidth || (right&&left.getBoundingClientRect().right>right.getBoundingClientRect().left-3))return 'Nome/referência e tamanhos não cabem nesta linha. Revise os textos antes de exportar.';
  }
  return '';
}
function checkAllFooterOverflow() {
  for(const page of pages){const node=document.querySelector('[data-footer-warning="'+page.id+'"]');if(node){const message=footerOverflow(page);node.textContent=message;node.hidden=!message;}}
}
function assertPrintableFooters() {
  checkAllFooterOverflow();const blocked=pages.map((p,i)=>({number:i+1,message:footerOverflow(p)})).filter(p=>p.message);
  if(blocked.length)throw Error('Exportação bloqueada para evitar corte de referências. '+blocked.map(p=>'Página '+p.number+': '+p.message).join('\n'));
}
window.addEventListener('resize',checkAllFooterOverflow);
function groupCatalogActions() {
  if(document.getElementById('catalogActionsTrigger'))return;
  const toolbar=document.querySelector('.header-actions'),holder=document.createElement('div');holder.className='catalog-actions';
  const trigger=reviewButton('Ações do catálogo',holder,()=>{menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('button')?.focus();});trigger.id='catalogActionsTrigger';trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','catalogActionsMenu');
  const menu=document.createElement('div');menu.id='catalogActionsMenu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Ações do catálogo');menu.hidden=true;holder.append(menu);
  for(const el of [...toolbar.querySelectorAll('button')]){
    if(/downloadJsonPlan|copyJsonPlan|exportJsonPlan|openJsxExportModal|resetToPilot/.test(el.getAttribute('onclick')||'') || el.textContent.trim()==='Versões' || el.textContent.includes('Carregar JSON')){
      menu.append(el);el.setAttribute('role','menuitem');el.tabIndex=-1;el.addEventListener('click',()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');});
    }
  }
  toolbar.prepend(holder);
  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
  document.addEventListener('click',e=>{if(!holder.contains(e.target))close();});
  holder.addEventListener('keydown',e=>{
    if(e.key==='Tab'){close();}
    else if(e.key==='Escape'){close();trigger.focus();e.preventDefault();}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      if(menu.hidden){menu.hidden=false;trigger.setAttribute('aria-expanded','true');}
      const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);
      const next=e.key==='Home'?0:e.key==='End'?items.length-1:index<0?(e.key==='ArrowDown'?0:items.length-1):(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next]?.focus();e.preventDefault();
    }
  });
}
