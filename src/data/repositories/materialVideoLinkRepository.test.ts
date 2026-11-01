import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "../testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";
import { BAD_VIDEO_URL, videoLinkLabel } from "./materialVideoLinkRepository";

describe("material video links", () => {
  let db: TestDatabase;
  let repos: Repositories;
  beforeEach(async () => {
    db = await createNodeSqliteDatabase(); repos = createRepositories(db);
    await repos.documents.create({ id: "section", title: "Synthetic section" });
    await repos.documents.create({ id: "other", title: "Other section" });
  });
  afterEach(() => db.close());
  it("adds, lists oldest first for one material, renames and removes", async () => {
    const first = await repos.materialVideoLinks.add("section", " https://youtube.com/watch?v=test ", "  First  ");
    const second = await repos.materialVideoLinks.add("section", "http://example.com/lesson");
    await repos.materialVideoLinks.add("other", "https://example.com/other");
    expect(await repos.materialVideoLinks.list("section")).toEqual([first, second]);
    expect(second.url).toBe("https://example.com/lesson"); // http is upgraded; only https opens
    await repos.materialVideoLinks.rename(first.id, "  New name  ");
    expect((await repos.materialVideoLinks.list("section"))[0]).toMatchObject({ title: "New name", url: first.url, createdAt: first.createdAt });
    await repos.materialVideoLinks.remove(first.id);
    expect(await repos.materialVideoLinks.list("section")).toEqual([second]);
  });
  it.each(["javascript:alert(1)", "file:///tmp/video.mp4", "data:text/plain,hello", "ftp://example.com", "not a link", "", "https://example.com/" + "a".repeat(2000)])("rejects bad URL %s", async (url) => {
    await expect(repos.materialVideoLinks.add("section", url)).rejects.toThrow(BAD_VIDEO_URL);
    expect(await repos.materialVideoLinks.list("section")).toEqual([]);
  });
  it("enforces title and URL limits for add and rename", async () => {
    await expect(repos.materialVideoLinks.add("section", "https://example.com", "a".repeat(201))).rejects.toThrow("200");
    const link = await repos.materialVideoLinks.add("section", "https://example.com/" + "a".repeat(1980), "a".repeat(200));
    expect(link.url).toHaveLength(2000);
    await expect(repos.materialVideoLinks.rename(link.id, "a".repeat(201))).rejects.toThrow("200");
    await repos.materialVideoLinks.rename(link.id, "  ");
    expect((await repos.materialVideoLinks.list("section"))[0]?.title).toBe("");
  });
  it("cascade deletes only the removed material's links", async () => {
    await repos.materialVideoLinks.add("section", "https://example.com");
    const other = await repos.materialVideoLinks.add("other", "https://example.com");
    await db.execute("DELETE FROM study_materials WHERE id = ?", ["section"]);
    expect(await repos.materialVideoLinks.list("section")).toEqual([]);
    expect(await repos.materialVideoLinks.list("other")).toEqual([other]);
  });
  it("uses a short display label without changing the saved URL", () => {
    const url = "https://example.com/" + "lesson/".repeat(30) + "?v=123";
    expect(videoLinkLabel({ url, title: "" })).toHaveLength(78);
    expect(videoLinkLabel({ url: "https://example.com/lesson?v=123", title: "" })).toBe("example.com/lesson");
    expect(videoLinkLabel({ url, title: "My lesson" })).toBe("My lesson");
  });
});
