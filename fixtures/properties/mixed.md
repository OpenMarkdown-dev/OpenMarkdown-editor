---
# 作者填写:下面每一行代表一种 frontmatter 写法(本行是注释,不应显示成属性)
title: '旧标题'
作者: 张三
status: draft # 行尾注释,不属于值
note: "带 \"转义\" 的双引号"
tags: [dialect, fixture]
empty:
desc: |
  多行字符串,
  这一行只读
meta:
  owner: 张三
list:
  - a
  - b
ref: &anchor 1
---

# Properties 手测(change: properties-block)

上面的 frontmatter 应呈现为 Properties 块。逐项核对:

1. 注释行不显示;`title` / `作者` / `status` / `note` / `tags` / `empty` 六行的值可点进去就地改(中文属性名也是普通属性)
2. `desc`(多行字符串)、`meta`(嵌套映射)、`list`(块列表)、`ref`(锚点)四行只显示原文,点值不进入编辑
3. 把 `title` 改成别的字后按 Esc:文件里只有 `旧标题` 那几个字变了,单引号保留,注释和其他行字节不变
4. 把 `status` 改成 `draft: 待审` 后按 Esc:该行变为 `status: "draft: 待审"`,行尾注释被替换前已不属于值
5. 「按源码编辑」→ 整块变回 YAML;光标移到正文 → 回到 Properties
