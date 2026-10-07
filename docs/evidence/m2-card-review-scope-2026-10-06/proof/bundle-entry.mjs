import { fsrs, generatorParameters, createEmptyCard, Rating } from "ts-fsrs";
export const s = fsrs(generatorParameters({ enable_fuzz: false }));
export { createEmptyCard, Rating };
