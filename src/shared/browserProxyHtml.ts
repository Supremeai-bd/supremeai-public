/**
 * Shared HTML/JSON/cookie formatting and srcdoc runtime shim builder used by both
 * the Express `/api/workspace/browser-proxy` route (`server.ts`) and the Cloudflare
 * Pages Edge Function (`functions/api/workspace/browser-proxy.ts`).
 */

export function extractCapturedCookieHeader(headers: Headers): string {
  const hWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const rawList: string[] =
    typeof hWithGetSetCookie.getSetCookie === 'function'
      ? hWithGetSetCookie.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : [];
  const pairs: string[] = [];
  for (const raw of rawList) {
    const firstSegment = raw.split(';')[0]?.trim();
    if (firstSegment && firstSegment.includes('=')) {
      pairs.push(firstSegment);
    }
  }
  return pairs.join('; ');
}

export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function buildJsonViewerHtml(prettyJson: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#090d16;color:#a5f3fc;font-family:ui-monospace,monospace;padding:20px;font-size:13px;line-height:1.6;}pre{white-space:pre-wrap;word-break:break-word;}</style></head><body><pre>${escapeHtmlText(prettyJson)}</pre></body></html>`;
}

export function buildTextViewerHtml(rawBody: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#090d16;color:#e2e8f0;font-family:ui-monospace,monospace;padding:20px;font-size:13px;line-height:1.6;}pre{white-space:pre-wrap;word-break:break-word;}</style></head><body><pre>${escapeHtmlText(rawBody.slice(0, 120000))}</pre></body></html>`;
}

// বাংলা মন্তব্য: প্যারেন্ট অরিজিন ভ্যালিডেশন — কেবল বৈধ http(s) অরিজিন হলে তা postMessage targetOrigin হিসেবে ব্যবহৃত হবে
export function normalizeProxyParentOrigin(rawOrigin?: string | null): string {
  const candidate = String(rawOrigin || '').trim();
  if (!candidate || candidate === 'null' || candidate === '*') return '';
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Ignore malformed origin
  }
  return '';
}

export function buildSrcdocRuntimeShims(
  finalUrl: string,
  parentOrigin?: string | null
): {
  headInject: string;
  bodyInject: string;
} {
  const safeBase = escapeHtmlAttr(finalUrl);
  const targetOriginLiteral = JSON.stringify(normalizeProxyParentOrigin(parentOrigin));
  // বাংলা মন্তব্য: postToHost হেল্পার নিশ্চিত করে যে কেবল top-level host উইন্ডোতে এবং নির্ধারিত targetOrigin-এ মেসেজ যাবে (nested 3rd-party frame লিক বন্ধ)
  const postToHostHelper =
    `var _hostOrigin=${targetOriginLiteral};` +
    `function _resolveTargetOrigin(){if(_hostOrigin)return _hostOrigin;try{if(document.referrer){var r=new URL(document.referrer).origin;if(r&&r!=='null')return r;}}catch(_){}try{if(window.location&&window.location.origin&&window.location.origin!=='null')return window.location.origin;}catch(_){}return '*';}` +
    `function postToHost(msg){try{if(window.parent!==window.top||window.parent===window)return;window.parent.postMessage(msg,_resolveTargetOrigin());}catch(_){}}`;

  const headInject =
    `<base href="${safeBase}" />` +
    `<script>(function(){` +
    postToHostHelper +
    `try{var _ls=window.localStorage;}catch(_e){` +
    `var mem=Object.create(null);var fake={getItem:function(k){return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null;},setItem:function(k,v){mem[String(k)]=String(v);},removeItem:function(k){delete mem[String(k)];},clear:function(){mem=Object.create(null);},key:function(i){return Object.keys(mem)[i]||null;},get length(){return Object.keys(mem).length;}};` +
    `try{Object.defineProperty(window,'localStorage',{value:fake,configurable:true});}catch(_){}` +
    `try{Object.defineProperty(window,'sessionStorage',{value:fake,configurable:true});}catch(_){}` +
    `}` +
    `try{var origPush=history.pushState.bind(history);history.pushState=function(s,t,u){try{return origPush(s,t,u);}catch(_){}};}catch(_){}` +
    `try{var origReplace=history.replaceState.bind(history);history.replaceState=function(s,t,u){try{return origReplace(s,t,u);}catch(_){}};}catch(_){}` +
    `try{window.open=function(u){if(typeof u==='string'&&u){try{postToHost({channel:'supremeai-browser',type:'navigate',href:new URL(u,document.baseURI).toString()});}catch(_){}}return null;};}catch(_){}` +
    `var pendingRpc=Object.create(null);var rpcSeq=0;` +
    `window.addEventListener('message',function(ev){` +
    `if(_hostOrigin&&ev.origin&&ev.origin!==_hostOrigin)return;` +
    `var d=ev&&ev.data;if(!d||d.channel!=='supremeai-browser-host'||d.type!=='proxy-rpc-response')return;` +
    `var entry=pendingRpc[d.requestId];if(!entry)return;` +
    `delete pendingRpc[d.requestId];clearTimeout(entry.timer);` +
    `if(d.error){entry.reject(new Error(d.error));}else{entry.resolve(d);}` +
    `});` +
    `function sendProxyRpc(url,method,headers,body){` +
    `return new Promise(function(resolve,reject){` +
    `var id='rpc_'+(++rpcSeq)+'_'+Date.now();` +
    `var timer=setTimeout(function(){if(pendingRpc[id]){delete pendingRpc[id];reject(new Error('Proxy RPC timeout'));}},20000);` +
    `pendingRpc[id]={resolve:resolve,reject:reject,timer:timer};` +
    `postToHost({channel:'supremeai-browser',type:'proxy-rpc',requestId:id,url:url,method:method||'GET',headers:headers||{},body:body});` +
    `});` +
    `}` +
    `function normalizeHeadersObj(h){var out={};if(!h)return out;if(typeof Headers!=='undefined'&&h instanceof Headers){h.forEach(function(v,k){out[k]=v;});return out;}if(Array.isArray(h)){h.forEach(function(p){if(p&&p.length>=2)out[String(p[0])]=String(p[1]);});return out;}if(typeof h==='object'){Object.keys(h).forEach(function(k){out[k]=String(h[k]);});}return out;}` +
    `var origFetch=typeof window.fetch==='function'?window.fetch.bind(window):null;` +
    `window.fetch=function(input,init){` +
    `try{` +
    `var rawUrl=typeof input==='string'?input:(input&&input.url?input.url:'');` +
    `if(!rawUrl||rawUrl.startsWith('data:')||rawUrl.startsWith('blob:')||rawUrl.startsWith('about:')){return origFetch?origFetch(input,init):Promise.reject(new Error('Fetch unavailable'));}` +
    `var resolved=new URL(rawUrl,document.baseURI).toString();` +
    `var method=(init&&init.method)||(input&&typeof input==='object'&&input.method)||'GET';` +
    `var hdrs=Object.assign({},input&&typeof input==='object'&&input.headers?normalizeHeadersObj(input.headers):{},init&&init.headers?normalizeHeadersObj(init.headers):{});` +
    `var readBody=function(){` +
    `if(init&&init.body!==undefined&&init.body!==null){` +
    `if(typeof init.body==='string')return Promise.resolve(init.body);` +
    `if(typeof URLSearchParams!=='undefined'&&init.body instanceof URLSearchParams){if(!hdrs['Content-Type']&&!hdrs['content-type'])hdrs['Content-Type']='application/x-www-form-urlencoded;charset=UTF-8';return Promise.resolve(init.body.toString());}` +
    `if(typeof FormData!=='undefined'&&init.body instanceof FormData){var usp=new URLSearchParams();init.body.forEach(function(v,k){if(typeof v==='string')usp.append(k,v);});if(!hdrs['Content-Type']&&!hdrs['content-type'])hdrs['Content-Type']='application/x-www-form-urlencoded;charset=UTF-8';return Promise.resolve(usp.toString());}` +
    `try{return Promise.resolve(String(init.body));}catch(_){return Promise.resolve(undefined);}` +
    `}` +
    `if(input&&typeof input==='object'&&typeof input.clone==='function'&&method.toUpperCase()!=='GET'&&method.toUpperCase()!=='HEAD'){return input.clone().text().catch(function(){return undefined;});}` +
    `return Promise.resolve(undefined);` +
    `};` +
    `return readBody().then(function(bodyStr){` +
    `return sendProxyRpc(resolved,String(method).toUpperCase(),hdrs,bodyStr).then(function(res){` +
    `var respHeaders=new Headers(res.headers||{});` +
    `var status=typeof res.status==='number'?res.status:200;` +
    `var bodyPayload=(status===204||status===205||status===304)?null:(res.body||'');` +
    `return new Response(bodyPayload,{status:status,statusText:res.statusText||'OK',headers:respHeaders});` +
    `});` +
    `});` +
    `}catch(_){return origFetch?origFetch(input,init):Promise.reject(new Error('Fetch proxy error'));}` +
    `};` +
    `var OrigXHR=window.XMLHttpRequest;` +
    `if(OrigXHR){` +
    `var ProxyXHR=function(){` +
    `this._method='GET';this._url='';this._headers={};this._listeners={};` +
    `this.readyState=0;this.status=0;this.statusText='';this.responseText='';this.response='';this.responseURL='';this.responseType='';` +
    `this._respHeaders={};this._native=null;` +
    `};` +
    `ProxyXHR.UNSENT=0;ProxyXHR.OPENED=1;ProxyXHR.HEADERS_RECEIVED=2;ProxyXHR.LOADING=3;ProxyXHR.DONE=4;` +
    `ProxyXHR.prototype.addEventListener=function(type,cb){if(this._native){this._native.addEventListener(type,cb);return;}if(!this._listeners[type])this._listeners[type]=[];this._listeners[type].push(cb);};` +
    `ProxyXHR.prototype.removeEventListener=function(type,cb){if(this._native){this._native.removeEventListener(type,cb);return;}if(!this._listeners[type])return;this._listeners[type]=this._listeners[type].filter(function(f){return f!==cb;});};` +
    `ProxyXHR.prototype._emit=function(type){var ev={type:type,target:this,currentTarget:this};var prop=this['on'+type];if(typeof prop==='function'){try{prop.call(this,ev);}catch(_){}}var list=this._listeners[type]||[];for(var i=0;i<list.length;i++){try{list[i].call(this,ev);}catch(_){}}};` +
    `ProxyXHR.prototype.open=function(method,url,async){` +
    `var raw=String(url||'');` +
    `if(raw.startsWith('data:')||raw.startsWith('blob:')){this._native=new OrigXHR();this._native.open(method,raw,async!==false);return;}` +
    `this._method=String(method||'GET').toUpperCase();` +
    `try{this._url=new URL(raw,document.baseURI).toString();}catch(_){this._url=raw;}` +
    `this.readyState=1;this._emit('readystatechange');` +
    `};` +
    `ProxyXHR.prototype.setRequestHeader=function(k,v){if(this._native){this._native.setRequestHeader(k,v);return;}this._headers[String(k)]=String(v);};` +
    `ProxyXHR.prototype.getResponseHeader=function(k){if(this._native)return this._native.getResponseHeader(k);var target=String(k||'').toLowerCase();var keys=Object.keys(this._respHeaders);for(var i=0;i<keys.length;i++){if(keys[i].toLowerCase()===target)return this._respHeaders[keys[i]];}return null;};` +
    `ProxyXHR.prototype.getAllResponseHeaders=function(){if(this._native)return this._native.getAllResponseHeaders();return Object.keys(this._respHeaders).map(function(k){return k+': '+this._respHeaders[k];}.bind(this)).join('\\r\\n');};` +
    `ProxyXHR.prototype.abort=function(){if(this._native){this._native.abort();return;}this.readyState=0;this._emit('abort');};` +
    `ProxyXHR.prototype.send=function(body){` +
    `if(this._native){this._native.send(body);return;}` +
    `var self=this;var payload=undefined;` +
    `if(body!==undefined&&body!==null){` +
    `if(typeof body==='string')payload=body;` +
    `else if(typeof URLSearchParams!=='undefined'&&body instanceof URLSearchParams){payload=body.toString();if(!self._headers['Content-Type']&&!self._headers['content-type'])self._headers['Content-Type']='application/x-www-form-urlencoded;charset=UTF-8';}` +
    `else if(typeof FormData!=='undefined'&&body instanceof FormData){var usp=new URLSearchParams();body.forEach(function(v,k){if(typeof v==='string')usp.append(k,v);});payload=usp.toString();if(!self._headers['Content-Type']&&!self._headers['content-type'])self._headers['Content-Type']='application/x-www-form-urlencoded;charset=UTF-8';}` +
    `else{try{payload=String(body);}catch(_){}}` +
    `}` +
    `sendProxyRpc(self._url,self._method,self._headers,payload).then(function(res){` +
    `self.status=typeof res.status==='number'?res.status:200;` +
    `self.statusText=res.statusText||'OK';` +
    `self.responseURL=res.finalUrl||self._url;` +
    `self._respHeaders=res.headers||{};` +
    `var text=typeof res.body==='string'?res.body:'';` +
    `self.responseText=text;` +
    `if(self.responseType==='json'){try{self.response=JSON.parse(text);}catch(_){self.response=null;}}else{self.response=text;}` +
    `self.readyState=2;self._emit('readystatechange');` +
    `self.readyState=3;self._emit('readystatechange');` +
    `self.readyState=4;self._emit('readystatechange');self._emit('load');self._emit('loadend');` +
    `}).catch(function(){` +
    `self.status=0;self.readyState=4;self._emit('readystatechange');self._emit('error');self._emit('loadend');` +
    `});` +
    `};` +
    `window.XMLHttpRequest=ProxyXHR;` +
    `}` +
    `})();</script>`;

  const bodyInject =
    `<script>(function(){` +
    postToHostHelper +
    `function findUsernameForPw(pwEl,scope){var root=scope||document;var list=root.querySelectorAll('input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i],input[name*="login" i],input[type="text"]');for(var i=0;i<list.length;i++){if(list[i]!==pwEl&&list[i].value&&list[i].value.trim())return list[i].value.trim();}return '';}` +
    `var lastEmitSig='';var lastEmitAt=0;` +
    `function emitSubmittedLogin(scope){try{var root=scope||document;var pw=root.querySelector('input[type="password"]');if(!pw||!pw.value)return;var u=findUsernameForPw(pw,root);if(!u)return;var dom='';try{dom=new URL(document.baseURI).hostname;}catch(_){}var sig=dom+'|'+u+'|'+pw.value;var now=Date.now();if(sig===lastEmitSig&&now-lastEmitAt<800)return;lastEmitSig=sig;lastEmitAt=now;postToHost({channel:'supremeai-browser',type:'login-credentials-submitted',domain:dom,username:u,password:pw.value});}catch(_){}}` +
    `document.addEventListener('click',function(ev){` +
    `var subBtn=ev.target&&ev.target.closest?ev.target.closest('button,input[type="submit"]'):null;` +
    `if(subBtn){var bf=subBtn.form||(subBtn.closest?subBtn.closest('form'):null);emitSubmittedLogin(bf||document);}` +
    `var el=ev.target&&ev.target.closest?ev.target.closest('a[href]'):null;` +
    `if(!el)return;` +
    `var href=el.getAttribute('href')||'';` +
    `if(!href||href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('tel:'))return;` +
    `ev.preventDefault();` +
    `try{` +
    `var resolvedUrl=new URL(href,document.baseURI);` +
    `if(resolvedUrl.hostname.indexOf('duckduckgo.com')!==-1&&resolvedUrl.searchParams.get('uddg')){resolvedUrl=new URL(resolvedUrl.searchParams.get('uddg'));}` +
    `postToHost({channel:'supremeai-browser',type:'navigate',href:resolvedUrl.toString()});` +
    `}catch(_){}` +
    `},true);` +
    `document.addEventListener('submit',function(ev){` +
    `var form=ev.target;if(!form)return;` +
    `emitSubmittedLogin(form);` +
    `ev.preventDefault();` +
    `var method=(form.getAttribute('method')||form.method||'get').toLowerCase();` +
    `try{` +
    `var rawAction=form.getAttribute('action')||document.baseURI;` +
    `var u=new URL(rawAction,document.baseURI);` +
    `var fd=new FormData(form);` +
    `if(method==='get'){` +
    `fd.forEach(function(v,k){if(typeof v==='string')u.searchParams.set(k,v);});` +
    `postToHost({channel:'supremeai-browser',type:'navigate',href:u.toString()});` +
    `}else{` +
    `var enc=(form.getAttribute('enctype')||'application/x-www-form-urlencoded').toLowerCase();` +
    `var usp=new URLSearchParams();fd.forEach(function(v,k){if(typeof v==='string')usp.append(k,v);});` +
    `var payload=usp.toString();var ctype='application/x-www-form-urlencoded;charset=UTF-8';` +
    `if(enc==='application/json'){var obj={};fd.forEach(function(v,k){if(typeof v==='string')obj[k]=v;});payload=JSON.stringify(obj);ctype='application/json';}` +
    `postToHost({channel:'supremeai-browser',type:'submit-form',action:u.toString(),method:method.toUpperCase(),contentType:ctype,body:payload});` +
    `}` +
    `}catch(_){}` +
    `},true);` +
    `function scanLoginForm(){try{var pw=document.querySelector('input[type="password"]');if(pw){postToHost({channel:'supremeai-browser',type:'login-form-detected',hasPassword:true});}}catch(_){}}` +
    `function emitLiveCookies(){try{if(document.cookie){postToHost({channel:'supremeai-browser',type:'cookies-captured',cookies:document.cookie});}}catch(_){}}` +
    `if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){scanLoginForm();emitLiveCookies();});}else{scanLoginForm();emitLiveCookies();}` +
    `document.addEventListener('focusin',function(ev){var t=ev.target;if(!t||t.tagName!=='INPUT')return;var tp=(t.type||'text').toLowerCase();if(tp==='password'||tp==='email'||tp==='text'){scanLoginForm();}},true);` +
    `window.addEventListener('message',function(ev){` +
    `if(_hostOrigin&&ev.origin&&ev.origin!==_hostOrigin)return;` +
    `var d=ev&&ev.data;if(!d||d.channel!=='supremeai-browser-host'||d.type!=='autofill-credentials')return;` +
    `try{` +
    `var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');` +
    `var setVal=function(el,v){if(!el||typeof v!=='string')return;if(setter&&setter.set){setter.set.call(el,v);}else{el.value=v;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};` +
    `var pwEl=document.querySelector('input[type="password"]');` +
    `var userEl=document.querySelector('input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i],input[name*="login" i],input[type="text"]');` +
    `var count=0;` +
    `if(userEl&&d.username){setVal(userEl,d.username);count++;}` +
    `if(pwEl&&d.password){setVal(pwEl,d.password);count++;pwEl.focus();}` +
    `postToHost({channel:'supremeai-browser',type:'autofill-applied',filledFields:count});` +
    `}catch(_){}` +
    `});` +
    `})();</script>`;

  return { headInject, bodyInject };
}

export function processProxiedHtml(
  rawBody: string,
  finalUrl: string,
  fallbackHost: string,
  parentOrigin?: string | null
): {
  title: string;
  html: string;
  extractedLinks: Array<{ href: string; text: string }>;
  textPreview: string;
} {
  const titleMatch = rawBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeBasicEntities(titleMatch[1]) : fallbackHost;

  const linkMatches = [...rawBody.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const extractedLinks = linkMatches
    .slice(0, 28)
    .map((m) => {
      let resolvedHref = m[1];
      try {
        resolvedHref = new URL(m[1], finalUrl).toString();
      } catch {
        // Keep raw href fallback
      }
      return {
        href: resolvedHref,
        text: decodeBasicEntities(m[2].replace(/<[^>]+>/g, '')) || m[1],
      };
    })
    .filter((l) => l.text.length > 0 && !l.href.startsWith('javascript:'));

  const { headInject, bodyInject } = buildSrcdocRuntimeShims(finalUrl, parentOrigin);
  let cleanHtml = rawBody
    .replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');

  if (/<head[^>]*>/i.test(cleanHtml)) {
    cleanHtml = cleanHtml.replace(/<head([^>]*)>/i, `<head$1>${headInject}`);
  } else if (/<html[^>]*>/i.test(cleanHtml)) {
    cleanHtml = cleanHtml.replace(/<html([^>]*)>/i, `<html$1><head>${headInject}</head>`);
  } else {
    cleanHtml = `<!doctype html><html><head>${headInject}</head><body>${cleanHtml}</body></html>`;
  }

  if (/<\/body>/i.test(cleanHtml)) {
    cleanHtml = cleanHtml.replace(/<\/body>/i, `${bodyInject}</body>`);
  } else {
    cleanHtml = `${cleanHtml}${bodyInject}`;
  }

  const textPreview = rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);

  return {
    title,
    html: cleanHtml,
    extractedLinks,
    textPreview,
  };
}
