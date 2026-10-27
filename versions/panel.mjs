import { SharedVersions } from './client.mjs?v=6e96fd451c06';

export function mountVersionPanel({ toolbar, getPlan, applyPlan, confirmLoad }) {
  const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const button=make('button','Versões');button.type='button';button.className='btn btn-secondary';button.title='Abrir ou salvar uma versão do catálogo';toolbar.append(button);
  const dialog=make('dialog');dialog.className='versions-dialog';dialog.setAttribute('aria-label','Versões do catálogo');
  const header=make('header'), heading=make('h2','Versões do catálogo'), close=make('button','Fechar');close.type='button';header.append(heading,close);
  const description=make('p','Abra uma base preservada ou guarde sua revisão com um nome. Salvar sempre cria uma nova versão.');
  const current=make('p');current.className='versions-current';current.setAttribute('aria-live','polite');
  const status=make('p');status.setAttribute('role','status');
  const notice=make('p',location.hostname==='127.0.0.1'?'Teste local: o provedor compartilhado é simulado e temporário. Use Salvar JSON para guardar seu trabalho.':'Versões disponíveis para os usuários autorizados deste catálogo.');notice.className='versions-notice';
  const login=make('a','Entrar para acessar versões');login.href='#';login.addEventListener('click',e=>{e.preventDefault();window.NeonPilot.showLogin();});
  const form=make('form'),label=make('label','Nome da nova versão'),name=make('input');name.type='text';name.maxLength=80;name.required=true;name.id='sharedVersionName';label.htmlFor=name.id;
  const save=make('button','Salvar nova versão');save.type='submit';form.append(label,name,save);
  const refresh=make('button','Atualizar lista');refresh.type='button';const list=make('ul');list.className='versions-list';list.setAttribute('aria-label','Versões disponíveis');
  dialog.append(header,description,current,notice,status,login,form,refresh,list);document.body.append(dialog);
  const warning=make('dialog');warning.className='versions-dialog versions-warning';warning.setAttribute('aria-label','Alterações não salvas');document.body.append(warning);
  const stable=value=>JSON.stringify(value,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
  const confirmChange=message=>new Promise(resolve=>{
    warning.replaceChildren(make('h2','Há alterações não salvas'),make('p','Você pode guardar o plano em JSON antes de abrir a outra versão, ou voltar para salvar uma nova versão com nome.'));
    let settled=false;const done=value=>{if(settled)return;settled=true;warning.close();resolve(value);};
    const action=(label,fn)=>{const b=make('button',label);b.type='button';b.addEventListener('click',fn);warning.append(b);};
    action('Salvar JSON e abrir',()=>{try{window.downloadJsonPlan();done(true);}catch(error){status.textContent=error.message;done(false);}});
    action('Voltar e salvar nova versão',()=>{done(false);name.focus();});action('Abrir sem salvar',()=>done(true));action('Cancelar',()=>done(false));
    warning.addEventListener('cancel',()=>done(false),{once:true});warning.showModal();warning.querySelector('button').focus();
  });
  const client=new SharedVersions({getPlan,applyPlan,confirmLoad:confirmLoad||confirmChange,changed:render});
  function render(){
    const selected=client.versions.find(v=>v.id===client.parentId);current.textContent='Em edição: '+(selected?.name||'Plano local — origem ainda não identificada')+(client.isDirty()?' · com alterações locais':'');
    save.textContent=client.pending?'Confirmar tentativa pendente':'Salvar nova versão';name.disabled=!!client.pending;name.required=!client.pending;list.replaceChildren();
    if(!client.versions.length)list.append(make('li','Nenhuma versão retornada. O plano local continua preservado.'));
    for(const v of client.versions){
      const item=make('li');item.className='version-card'+(v.id===client.parentId?' is-current':'');
      const title=make('h3',v.name),type=make('p',v.readOnly?(v.name.startsWith('Última versão refinada pelo Markus')?'Base original refinada pelo Markus · preservada':'Ender v04 · lapidação preservada'):'Versão salva · snapshot preservado');
      const author=make('p',(v.author?.name||'Autoria não informada')+' · '+(v.createdAt?new Date(v.createdAt).toLocaleString():'Data não informada'));
      const load=make('button',v.id===client.parentId&&!client.isDirty()?'Versão atual':'Abrir versão');load.type='button';load.disabled=v.id===client.parentId&&!client.isDirty();
      load.addEventListener('click',async()=>{load.disabled=true;try{if(await client.load(v.id)){status.textContent='Versão aberta.';dialog.close();returnFocus();}}catch(error){status.textContent=error.message;}finally{render();}});
      item.append(title,type,author,load);list.append(item);
    }
  }
  async function identifyPreservedBase(){
    if(client.parentId||client.pending)return;
    const currentPlan=stable(getPlan());
    for(const v of client.versions.filter(v=>v.readOnly)){
      const snapshot=await client.request('/versions/'+encodeURIComponent(v.id));
      const normalized=globalThis.KallineReview?KallineReview.normalize(structuredClone(snapshot.plan)):snapshot.plan;
      if(stable(normalized)===currentPlan&&stable(getPlan())===currentPlan){client.parentId=v.id;client.baseline=currentPlan;client.rememberCurrent();return;}
    }
  }
  async function refreshList(){
    status.textContent='Buscando versões…';
    try{await client.connect();login.hidden=true;form.hidden=false;await client.refresh();await identifyPreservedBase();render();status.textContent='Lista atualizada.';}
    catch(error){status.textContent=error.message;form.hidden=error.code==='SIGN_IN_REQUIRED';login.hidden=!form.hidden;}
  }
  const returnFocus=()=>{const menu=document.getElementById('catalogActionsMenu');if(menu&&menu.hidden)document.getElementById('catalogActionsTrigger')?.focus();else button.focus();};
  button.addEventListener('click',()=>{dialog.showModal();render();refreshList();close.focus();});
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',returnFocus);refresh.addEventListener('click',refreshList);
  form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;status.textContent='Confirmando gravação…';try{const v=await client.save(name.value);status.textContent='Versão salva: '+v.name;render();await client.refresh().catch(()=>{});}catch(error){status.textContent=error.message;render();}finally{save.disabled=false;}});
  const unload=e=>client.beforeUnload(e);window.addEventListener('beforeunload',unload);dialog.addEventListener('close',()=>client.stopPolling());dialog.addEventListener('toggle',()=>{if(dialog.open&&!document.hidden)client.startPolling();else client.stopPolling();});document.addEventListener('visibilitychange',()=>{if(dialog.open&&!document.hidden)client.startPolling();else client.stopPolling();});
  return{client,destroy(){client.stopPolling();window.removeEventListener('beforeunload',unload);button.remove();dialog.remove();warning.remove();}};
}
