export function taskError(statusCode:number,code:string,message:string){return Object.assign(new Error(message),{statusCode,code});}
