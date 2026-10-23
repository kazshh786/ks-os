// Used only by the isolated browser fixture; production uses the normal authenticated client.
export const fetchWithAuth=(path:string,options:RequestInit={})=>fetch(path,{...options,headers:{...(options.body==null?{}:{'Content-Type':'application/json'}),...options.headers}});
export async function requestJson<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetchWithAuth(path,options);const result=await response.json();if(!response.ok)throw new Error(result.error?.message||result.error||'Request failed');return result;}

export async function uploadWithAuth(path:string,body:Blob,signal:AbortSignal,progress:(n:number)=>void){
 progress(0);const response=await fetch(path,{method:'PUT',body,signal,headers:{'Content-Type':'application/octet-stream'}});progress(100);return response;
}
