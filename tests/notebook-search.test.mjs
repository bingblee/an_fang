import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNotebookQuery,
  notebookSearchSnippet,
  searchNotebookNotes
} from "../lib/notebook-search.mjs";

const notes = [
  {
    title: "披萨准备",
    summary: "周末在家做晚餐",
    content: "购买高筋面粉、番茄和马苏里拉奶酪。",
    sourceItemTitle: "购买披萨材料"
  },
  {
    title: "高铁信息",
    summary: "下午前往上海",
    content: "17:58 从合肥南出发，记得提前到站。",
    sourceItemTitle: null
  }
];

test("notebook search normalizes width, case, and whitespace", () => {
  assert.equal(normalizeNotebookQuery("  ＰＩＺＺＡ   Plan  "), "pizza plan");
});

test("notebook search matches every term across title, content, and source", () => {
  assert.deepEqual(searchNotebookNotes(notes, "披萨 材料"), [notes[0]]);
  assert.deepEqual(searchNotebookNotes(notes, "合肥 17:58"), [notes[1]]);
  assert.deepEqual(searchNotebookNotes(notes, "不存在"), []);
  assert.equal(searchNotebookNotes(notes, "   "), notes);
});

test("notebook search returns a useful matching excerpt", () => {
  assert.match(notebookSearchSnippet(notes[1], "合肥"), /合肥南出发/);
});
