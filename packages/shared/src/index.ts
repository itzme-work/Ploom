export interface Server {id:string; name:string; subscriptionId:string}
export interface Subscription {id:string; name:string}
export interface SecureStorage {read(id:string):Promise<string|null>; write(id:string,value:string):Promise<void>; remove(id:string):Promise<void>}
export interface VpnEngine {
 prepare():Promise<void>; connect(server:Server):Promise<void>; disconnect():Promise<void>;
 getStatus():'unsupported'; getStatistics():null; dispose():void
}
export class UnsupportedVpnEngine implements VpnEngine {
 async prepare(){throw new Error('VPN_UNSUPPORTED')}
 async connect(_server:Server){await this.prepare()}
 async disconnect(){} getStatus(){return 'unsupported' as const} getStatistics(){return null} dispose(){}
}
