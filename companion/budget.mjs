import {AsyncLocalStorage} from 'node:async_hooks';
const budget=new AsyncLocalStorage();
export const processingDeadline=()=>budget.getStore()??Date.now()+600000;
export const processingBudget=(action,ms=600000)=>budget.run(Math.min(budget.getStore()??Infinity,Date.now()+ms),action);
