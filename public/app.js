const dateOnly=v=>v?String(v).slice(0,10):v;const state={page:1,limit:12,search:'',sort:'last_seen_at',direction:'desc',age_min:'',age_max:'',bust_min:'',bust_max:'',waist_min:'',waist_max:'',hip_min:'',hip_max:'',cup:''};
const proxyImage=u=>u?'/api/image?url='+encodeURIComponent(u):'';const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),img=a=>proxyImage(a.image_url||(a.listing_data&&a.listing_data.image_url)||'');
const lightboxAttrs=(src,alt,caption='')=>src?'data-lightbox-src="'+esc(src)+'" data-lightbox-alt="'+esc(alt||'')+'" data-lightbox-caption="'+esc(caption||'')+'" tabindex="0" role="button"':'';
const imageViewer=document.createElement('dialog');
imageViewer.id='imageViewer';
imageViewer.innerHTML='<div class="image-viewer-shell"><button class="close image-viewer-close" id="imageViewerClose" aria-label="关闭图片预览">×</button><figure class="image-viewer-figure"><img id="imageViewerImage" alt=""><figcaption id="imageViewerCaption"></figcaption></figure></div>';
document.body.appendChild(imageViewer);
const imageViewerImage=$('#imageViewerImage'),imageViewerCaption=$('#imageViewerCaption');
function openImageViewer(src,alt='',caption=''){if(!src)return;imageViewerImage.src=src;imageViewerImage.alt=alt;imageViewerCaption.textContent=caption||alt;imageViewer.showModal()}
function closeImageViewer(){if(imageViewer.open)imageViewer.close()}
document.addEventListener('click',e=>{const target=e.target.closest?.('[data-lightbox-src]');if(!target)return;e.preventDefault();e.stopPropagation();openImageViewer(target.dataset.lightboxSrc,target.dataset.lightboxAlt||target.alt,target.dataset.lightboxCaption||'')},true);
document.addEventListener('keydown',e=>{const target=e.target.closest?.('[data-lightbox-src]');if(target&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openImageViewer(target.dataset.lightboxSrc,target.dataset.lightboxAlt||target.alt,target.dataset.lightboxCaption||'')}});
$('#imageViewerClose').onclick=closeImageViewer;
imageViewer.onclick=e=>{if(e.target===imageViewer||e.target.classList.contains('image-viewer-shell'))closeImageViewer()};
imageViewer.addEventListener('close',()=>{imageViewerImage.removeAttribute('src');imageViewerCaption.textContent='' });
const advanced=document.createElement('div');advanced.className='advanced';advanced.innerHTML='<span class="adv-label">高级检索</span><input data-k="age_min" type="number" min="0" placeholder="年龄 ≥"><input data-k="age_max" type="number" min="0" placeholder="年龄 ≤"><input data-k="bust_min" type="number" min="0" placeholder="胸围 ≥"><input data-k="bust_max" type="number" min="0" placeholder="胸围 ≤"><input data-k="waist_min" type="number" min="0" placeholder="腰围 ≥"><input data-k="waist_max" type="number" min="0" placeholder="腰围 ≤"><input data-k="hip_min" type="number" min="0" placeholder="臀围 ≥"><input data-k="hip_max" type="number" min="0" placeholder="臀围 ≤"><input data-k="cup" placeholder="罩杯，如 C"><button id="applyAdvanced">应用</button>';document.querySelector('.toolbar').after(advanced);
function card(a){const src=img(a);return '<article class="card" data-id="'+esc(a.actress_id)+'"><div class="portrait">'+(src?'<img loading="lazy" class="zoomable-media" src="'+esc(src)+'" alt="'+esc(a.name)+'" '+lightboxAttrs(src,a.name,'演员预览图')+'>':'')+'<span class="badge">'+esc(a.actress_id)+'</span></div><div class="card-info"><h2>'+esc(a.name)+'</h2><p>'+esc(a.name_kana||'')+(a.birthplace?' · '+esc(a.birthplace):'')+'</p></div></article>'}
async function load(){const q=new URLSearchParams({page:state.page,limit:state.limit,sort:state.sort,direction:state.direction});Object.keys(state).filter(k=>k.endsWith('_min')||k.endsWith('_max')||k==='cup').forEach(k=>{if(state[k])q.set(k,state[k])});if(state.search)q.set('search',state.search);try{const r=await fetch('/api/actresses?'+q),j=await r.json();if(!r.ok)throw Error(j.error);$('#notice').classList.add('hidden');$('#totalTop').textContent=Number(j.pagination.total).toLocaleString();$('#grid').innerHTML=j.data.map(card).join('');$('#empty').classList.toggle('hidden',j.data.length>0);$('#pageLabel').textContent=j.pagination.page+' / '+Math.max(1,j.pagination.pages);$('#prev').disabled=state.page<=1;$('#next').disabled=state.page>=j.pagination.pages;document.querySelectorAll('.card').forEach(c=>c.onclick=()=>showDetail(c.dataset.id))}catch(e){$('#notice').textContent=e.message;$('#notice').classList.remove('hidden');$('#grid').innerHTML='';$('#empty').classList.add('hidden')}}
async function showDetail(id){const r=await fetch('/api/actresses/'+id),j=await r.json(),a=j.data;if(!r.ok)return;const src=img(a);$('#detail').innerHTML='<div class="detail-wrap">'+(src?'<img class="detail-photo zoomable-media" src="'+esc(src)+'" alt="'+esc(a.name)+'" '+lightboxAttrs(src,a.name,'演员预览图')+'>':'<div class="detail-photo"></div>')+'<div class="detail-copy"><div class="eyebrow">PROFILE / '+esc(a.actress_id)+'</div><h2>'+esc(a.name)+'</h2><div class="kana">'+esc(a.name_kana||'')+'</div><div class="facts">'+[['生日',dateOnly(a.birthday)],['出生地',a.birthplace],['身高',a.height_cm&&a.height_cm+' cm'],['三围',a.bust_cm&&a.bust_cm+' / '+(a.waist_cm||'—')+' / '+(a.hip_cm||'—')],['罩杯',a.cup_size]].map(x=>'<div class="fact"><small>'+x[0]+'</small>'+esc(x[1]||'—')+'</div>').join('')+'</div>'+(a.profile_text?'<p class="bio">'+esc(a.profile_text)+'</p>':'')+'</div></div>';$('#modal').showModal()}
$('#search').oninput=e=>{clearTimeout(window._t);window._t=setTimeout(()=>{state.search=e.target.value.trim();state.page=1;load()},280)};document.querySelectorAll('.sort').forEach(b=>b.onclick=()=>{if(state.sort===b.dataset.sort)state.direction=state.direction==='asc'?'desc':'asc';else{state.sort=b.dataset.sort;state.direction='desc'}document.querySelectorAll('.sort').forEach(x=>x.classList.remove('active'));b.classList.add('active');b.textContent=(b.dataset.sort==='birthday'?'生日':' '+b.textContent.replace(/[ ↑↓]/g,''))+(state.sort===b.dataset.sort?(state.direction==='asc'?' ↑':' ↓'):'');state.page=1;load()});document.querySelectorAll('.advanced input').forEach(i=>i.onchange=()=>state[i.dataset.k]=i.value);$('#applyAdvanced').onclick=()=>{state.page=1;load()};$('#prev').onclick=()=>{if(state.page>1){state.page--;load()}};$('#next').onclick=()=>{state.page++;load()};$('#close').onclick=()=>$('#modal').close();$('#modal').onclick=e=>{if(e.target===$('#modal'))$('#modal').close()};load();



// Javbus browsing panel
const javbusDialog=document.createElement('dialog');javbusDialog.id='javbusDialog';javbusDialog.innerHTML='<button class="close" id="javbusClose">×</button><div class="javbus-panel"><div class="eyebrow">JAVBUS / WORKS INDEX</div><div class="javbus-search"><input id="javbusKeyword" placeholder="输入演员姓名检索作品"><button id="javbusSearchBtn">检索作品</button></div><div id="javbusNotice" class="notice hidden"></div><div id="movieGrid" class="movie-grid"></div></div>';document.body.appendChild(javbusDialog);
const moviePage=document.createElement('dialog');moviePage.id='moviePage';moviePage.setAttribute('aria-label','作品详情');moviePage.innerHTML='<header class="movie-page-header"><span>作品详情</span><button class="close" id="moviePageClose" aria-label="返回作品列表">×</button></header><div id="moviePageContent" class="movie-page-content"></div>';document.body.appendChild(moviePage);
function javbusMessage(msg){const n=document.querySelector('#javbusNotice');n.textContent=msg;n.classList.remove('hidden')}
async function searchMovies(keyword){document.querySelector('#javbusNotice').classList.add('hidden');document.querySelector('#movieGrid').innerHTML='<p class="loading">正在检索…</p>';const oldDetail=document.querySelector('#movieDetail');if(oldDetail)oldDetail.innerHTML='';try{const r=await fetch('/api/javbus/search?keyword='+encodeURIComponent(keyword));const j=await r.json();if(!r.ok)throw Error(j.error);document.querySelector('#movieGrid').innerHTML=(j.movies||[]).map(m=>{const src=proxyImage(m.img||'');return '<article class="movie-card" data-movie="'+esc(m.id)+'"><img class="zoomable-media" src="'+esc(src)+'" alt="'+esc(m.title||m.id||'作品封面')+'" '+lightboxAttrs(src,m.title||m.id||'作品封面','作品封面')+'><div><b>'+esc(m.id)+'</b><p>'+esc(m.title)+'</p><small>'+esc(m.date||'')+'</small></div></article>'}).join('')||'<p class="loading">没有找到作品。</p>';document.querySelectorAll('[data-movie]').forEach(x=>x.onclick=()=>movieDetail(x.dataset.movie))}catch(e){document.querySelector('#movieGrid').innerHTML='';javbusMessage(e.message)}}
async function movieDetail(id){try{const r=await fetch('/api/javbus/movies/'+encodeURIComponent(id));const m=await r.json();if(!r.ok)throw Error(m.error);const cover=proxyImage(m.img||'');const stars=(m.stars||[]).map(x=>x.name).join('、');const genres=(m.genres||[]).map(x=>'<span>'+esc(x.name)+'</span>').join('');document.querySelector('#moviePageContent').innerHTML='<section class="movie-detail"><div><img class="movie-cover zoomable-media" src="'+esc(cover)+'" alt="'+esc(m.title||m.id||'作品封面')+'" '+lightboxAttrs(cover,m.title||m.id||'作品封面','作品封面')+'></div><div><div class="eyebrow">MOVIE / '+esc(m.id)+'</div><h2>'+esc(m.title)+'</h2><p class="movie-meta">'+esc(m.date||'')+(m.videoLength?' · '+m.videoLength+' min':'')+(stars?' · '+esc(stars):'')+'</p><div class="genres">'+genres+'</div><button class="magnet-btn" id="magnetBtn" aria-controls="magnetResult">查看磁力信息</button></div></section><section id="magnetResult" aria-label="磁力资源" aria-live="polite"></section>'+(m.samples&&m.samples.length?'<div class="samples">'+m.samples.map(s=>{const thumbnail=proxyImage(s.thumbnail||s.src||'');const full=proxyImage(s.src||s.thumbnail||'');return '<img class="work-sample zoomable-media" src="'+esc(thumbnail)+'" alt="'+esc(m.title||m.id||'作品样张')+'" loading="lazy" '+lightboxAttrs(full,m.title||m.id||'作品样张','作品样张')+'>'}).join('')+'</div>':'');javbusDialog.close();moviePage.showModal();moviePage.scrollTop=0;document.querySelector('#magnetBtn').onclick=()=>loadMagnets(m.id,m.gid,m.uc)}catch(e){javbusMessage(e.message)}}
const magnetPreviewCount=5;
function magnetCopyContent(copied=false){
  const shape=copied?'<path d="m4 8 3 3 5-6"/>':'<rect x="6" y="6" width="7" height="8" rx="1.5"/><path d="M10 6V3.5A1.5 1.5 0 0 0 8.5 2h-5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H6"/>';
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+shape+'</svg><span>'+(copied?'已复制':'复制链接')+'</span>';
}
function renderMagnetRows(items){
  const flag=v=>v===true||v===1||v==='true'||v==='1';
  return '<div class="magnet-heading"><div class="magnet-heading-title"><h3>磁力资源</h3><span class="magnet-count">'+items.length+' 条</span></div><span class="magnet-hint">选择资源，复制链接</span></div><ul class="magnet-list" id="magnetList">'+items.map((m,i)=>{
    const valid=typeof m.link==='string'&&/^magnet:\?xt=urn:btih:/i.test(m.link);
    return '<li class="magnet-row"'+(i>=magnetPreviewCount?' hidden':'')+'><span class="magnet-index" aria-hidden="true">'+String(i+1).padStart(2,'0')+'</span><div class="magnet-info"><div class="magnet-title">'+esc(m.title||m.id||'未命名资源')+'</div><div class="magnet-meta"><span class="magnet-size">'+esc(m.size||'大小未知')+'</span><span>'+esc(m.shareDate||'日期未知')+'</span>'+(flag(m.isHD)?'<span class="magnet-tag">高清</span>':'')+(flag(m.hasSubtitle)?'<span class="magnet-tag subtitle">字幕</span>':'')+'</div></div><button class="magnet-copy" data-index="'+i+'" '+(!valid?'disabled':'')+'>'+(valid?magnetCopyContent():'链接不可用')+'</button></li>';
  }).join('')+'</ul>'+(items.length>magnetPreviewCount?'<button class="magnet-toggle" aria-expanded="false" aria-controls="magnetList"><span>展开其余 '+(items.length-magnetPreviewCount)+' 条资源</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>':'');
}
async function loadMagnets(id,gid,uc){
  const box=document.querySelector('#magnetResult'),button=document.querySelector('#magnetBtn');
  box.setAttribute('aria-live','polite');box.setAttribute('aria-busy','true');
  button.disabled=true;box.innerHTML='<p class="magnet-status">正在加载资源…</p>';
  try{
    const r=await fetch('/api/javbus/magnets/'+encodeURIComponent(id)+'?gid='+encodeURIComponent(gid||'')+'&uc='+encodeURIComponent(uc||'0'));
    const j=await r.json();if(!r.ok)throw Error(j.error||'加载失败，请重试');
    const items=Array.isArray(j)?j:j?.magnets;
    if(!Array.isArray(items))throw Error('资源数据格式异常，请重试');
    const rows=items.filter(m=>m&&typeof m==='object');
    box.innerHTML=rows.length?renderMagnetRows(rows):'<p class="magnet-status">暂无磁力资源</p>';
    button.textContent='刷新磁力资源';
    const toggle=box.querySelector('.magnet-toggle');
    if(toggle)toggle.onclick=()=>{
      const expanded=toggle.getAttribute('aria-expanded')!=='true';
      box.querySelectorAll('.magnet-row').forEach((row,i)=>{row.hidden=!expanded&&i>=magnetPreviewCount});
      toggle.setAttribute('aria-expanded',String(expanded));
      toggle.querySelector('span').textContent=expanded?'收起资源列表':'展开其余 '+(rows.length-magnetPreviewCount)+' 条资源';
      if(!expanded)toggle.scrollIntoView({block:'nearest'});
    };
    box.querySelectorAll('.magnet-copy').forEach(b=>b.onclick=async()=>{
      const link=rows[Number(b.dataset.index)].link;
      clearTimeout(b.copyTimer);
      try{
        if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');
        await navigator.clipboard.writeText(link);b.innerHTML=magnetCopyContent(true);b.classList.add('is-copied');
        b.closest('li').querySelector('.magnet-manual')?.remove();
        b.copyTimer=setTimeout(()=>{b.innerHTML=magnetCopyContent();b.classList.remove('is-copied')},1800);
      }catch{
        b.classList.remove('is-copied');
        let input=b.closest('li').querySelector('.magnet-manual');
        if(!input){input=document.createElement('input');input.className='magnet-manual';input.readOnly=true;input.setAttribute('aria-label','复制失败，请手动复制磁力链接');b.closest('li').appendChild(input)}
        input.value=link;input.focus();input.select();b.textContent='请手动复制';
      }
    });
  }catch(e){box.innerHTML='<p class="magnet-status magnet-error">'+esc(e.message)+'</p>'}
  finally{box.setAttribute('aria-busy','false');button.disabled=false}
}
function openJavbus(name){document.querySelector('#javbusKeyword').value=name||'';javbusDialog.showModal();if(name)searchMovies(name)}
document.querySelector('#javbusClose').onclick=()=>javbusDialog.close();document.querySelector('#moviePageClose').onclick=()=>{moviePage.close();javbusDialog.showModal()};document.querySelector('#javbusSearchBtn').onclick=()=>searchMovies(document.querySelector('#javbusKeyword').value.trim());document.querySelector('#javbusKeyword').onkeydown=e=>{if(e.key==='Enter')searchMovies(e.target.value.trim())};
const detailObserver=new MutationObserver(()=>{const copy=document.querySelector('#detail .detail-copy');if(copy&&!copy.querySelector('#worksBtn')){const b=document.createElement('button');b.id='worksBtn';b.className='works-btn';b.textContent='查看作品库 ↗';b.onclick=()=>openJavbus(document.querySelector('#detail h2')?.textContent||'');copy.appendChild(b)}});detailObserver.observe(document.querySelector('#detail'),{childList:true,subtree:true});





