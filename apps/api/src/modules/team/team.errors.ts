export const teamError=(statusCode:number,code:string,message:string)=>Object.assign(new Error(message),{statusCode,code});
