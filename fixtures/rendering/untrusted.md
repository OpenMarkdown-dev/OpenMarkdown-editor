---
title: "<img src=x onerror=alert(1)>"
homepage: javascript:alert(1)
tags: [<script>alert(1)</script>]
---

# 不可信内容渲染手测 (editor-untrusted-content)

顶部 frontmatter(属性面板)的三个值都应显示为文字。

本文件是**别人写的**、带恶意样本的文档。在 live 与阅读两种模式里打开、滚动、悬停、Cmd/Ctrl+点击。**判定只有一条:任何东西都不执行**——不弹框、不跳页、不出现 `PWNED` 字样的标题变化、开发者工具 Console 里没有来自本文件的脚本报错。

> 所有样本都只做无害动作(`alert(1)` / 改标题为 `PWNED`)。真执行了也不会伤到什么,但那就是 bug。

## 1. 原始 HTML 块(应原样显示为源码,不渲染)

<script>document.title = "PWNED"; alert(1)</script>

<img src="x" onerror="document.title='PWNED'; alert(1)">

<iframe src="javascript:alert(1)"></iframe>

<svg onload="alert(1)"><circle r="10"></circle></svg>

<!-- <img src=x onerror=alert(1)> -->

<div style="position:fixed;inset:0;background:red" onclick="alert(1)">覆盖全屏的 div</div>

## 2. 行内 HTML(应显示为源码文字)

一句话里夹着 <img src=x onerror="alert(1)"> 和 <b onmouseover="alert(1)">粗体标签</b> 还有 <a href="javascript:alert(1)">一个 a 标签</a>。

## 3. 链接(Cmd/Ctrl+点击:什么也不打开;app 里出一条安静提示「不打开 javascript: 链接」之类)

- [脚本](javascript:alert(1))
- [大小写](JaVaScRiPt:alert(1))
- [前导空格](< javascript:alert(1)>)
- [实体混淆 &#106;](&#106;avascript:alert(1))
- [十六进制实体](&#x6A;avascript:alert(1))
- [冒号实体](javascript&colon;alert(1))
- [vbscript](vbscript:msgbox(1))
- [data HTML](data:text/html,<script>alert(1)</script>)
- [data base64](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)
- 自动链接:<javascript:alert(1)>

对照(正常链接,行为不变):[GitHub](https://github.com) 外部打开;[同目录](./links.md) app 内跳转;[锚点](#5-数学) 就地滚动。

## 4. 图片(恶意的显示为源码;正常的照常渲染)

- ![js 图](javascript:alert(1))
- ![data svg](data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>)
- ![data html](data:text/html,<script>alert(1)</script>)
- ![带 onerror 的路径](x" onerror="alert(1))
- 对照,应渲染为图:![方块](attachments/square.png)

## 5. 数学

$\href{javascript:alert(1)}{点我}$ —— 应渲染为普通文字/红色未知命令,不是可点击链接

$\url{javascript:alert(1)}$

$\class{x" onclick="alert(1)}{y}$ —— 不受信命令:显示源码 + 失败标记(悬停看原因)

$\style{background:url(https://example.com/t.png)}{y}$

$\includegraphics{https://example.com/t.png}$

$\text{<img src=x onerror=alert(1)>}$ —— 应显示尖括号文字

$$
\begin{equation}x\label{clobber}\end{equation}
$$

对照,应正常渲染:$E = mc^2$,以及

$$
\frac{a}{b} + \sqrt{x}
$$

## 6. 表格格内(与正文同一规则)

| 样本 | 内容 |
|------|------|
| 链接 | [脚本](javascript:alert(1)) |
| 行内 HTML | <img src=x onerror=alert(1)> |
| 图片 | ![js](javascript:alert(1)) |
| 公式 | $\href{javascript:alert(1)}{x}$ |
| 对照 | **粗体** 与 [GitHub](https://github.com) |

## 7. callout / 代码块(文字原样)

> [!WARNING]
> <img src=x onerror=alert(1)> 应是文字

```html
<script>alert(1)</script>
<img src=x onerror=alert(1)>
```
