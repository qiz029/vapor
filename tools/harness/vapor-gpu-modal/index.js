import {registerTools} from './register-tools.js';
export const inject=['vaporRuntime'];
export function apply(ctx,config={}){ctx.effect(()=>registerTools(ctx,config));}
