import { expect, it, vi } from "vitest";
const invoke=vi.hoisted(()=>vi.fn(async()=>({groups:[]})));
vi.mock("@tauri-apps/api/core",()=>({invoke}));
import { ALL_CONTENT_TYPES, SAVED_CONTENT_TYPES, searchOfflineContent } from "./offlineContent";
it("Homework uses the existing IPC with an explicit material-filter scope",async()=>{
 expect(ALL_CONTENT_TYPES).toContain("homework");expect(SAVED_CONTENT_TYPES).toContain("homework");
 await searchOfflineContent("clouds",[],0,["homework"],true);
 expect(invoke).toHaveBeenCalledWith("search_offline_content",{query:"clouds",materialIds:[],offset:0,contentTypes:["homework"],materialFiltersActive:true});
});
