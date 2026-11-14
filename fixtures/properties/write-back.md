---
title: 写回样例
status: draft
quoted: "已带 \"双引号\" 的值"
escaped: "第一行\n第二行"
---

# Properties 写回手测(change: write-back-valid)

上面的 frontmatter 有一个裸写值(`status`)、一个带引号的值(`quoted`)和一个含 `\n` 转义的值(`escaped`,只读)。每一步之后都可以点「按源码编辑」看文件里的原文,看完把光标移到正文即回到 Properties 块。

1. **demo 复现**:点「+ 添加属性」,名字键入 `key: x #[`,按 Tab,值键入 `{oops: [1, "`,按 Enter。预期:整个过程 Properties 块一直呈现、不退回源码;该行名字显示 `key: x #[`、值显示 `{oops: [1, "`。点「按源码编辑」,该行为 `"key: x #[": "{oops: [1, \""`,右引号后没有多余空格。
2. **未闭合引号**:点 `status` 的值,全选后键入 `"abc`。预期:每次按键后 Properties 块都仍呈现,子编辑器不中断;源码里该值为 `"\"abc"`。按 `Cmd+Z` 撤回到 `draft`。
3. **引号随文字来去**:点 `status` 的值 `draft`,在末尾键入 `: x`(此时源码为 `status: "draft: x"`),再退格删回 `draft`,按 Esc。预期:`git diff fixtures/properties/write-back.md` 对这一行为空。
4. **已带引号的值保留引号风格**:点 `quoted` 的值,子编辑器里显示 `已带 "双引号" 的值`(没有反斜杠);末尾加一个字再按 Esc。预期:该行仍是双引号写法,只多了那个字。
5. **只读的转义值**:点 `escaped` 的值。预期:不进入编辑,显示原文 `"第一行\n第二行"`;要改它走「按源码编辑」。

测毕 `git checkout -- fixtures/`。
