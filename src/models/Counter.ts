import { Schema, model } from 'mongoose';
export interface ICounter { _id: string; seq: number }
const schema = new Schema<ICounter>({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false });
export const Counter = model<ICounter>('Counter', schema);
