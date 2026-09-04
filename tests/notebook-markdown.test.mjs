import test from "node:test";
import assert from "node:assert/strict";
import {
  markdownToPlainText,
  notebookSummaryFromMarkdown,
  notebookTitleFromMarkdown
} from "../lib/notebook-markdown.mjs";

test("uses a Markdown heading as a clean generated title", () => {
  assert.equal(notebookTitleFromMarkdown("# 周末准备\n\n正文"), "周末准备");
});

test("removes list and task markers from a generated summary", () => {
  assert.equal(
    notebookSummaryFromMarkdown("# 周末准备\n\n- 带证件\n- [ ] 查看车次", false),
    "带证件 查看车次"
  );
});

test("keeps link labels while removing Markdown decoration", () => {
  assert.equal(
    markdownToPlainText("**重点**：查看 [车次](https://example.com)"),
    "重点：查看 车次"
  );
});
