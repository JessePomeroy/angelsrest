import { readable } from "svelte/store";
export const page = readable({ url: new URL("http://127.0.0.1:5196/admin") });
