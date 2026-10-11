// Used only by the isolated browser fixture; production uses the normal authenticated client.
export const fetchWithAuth=(path:string,options:RequestInit={})=>fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
