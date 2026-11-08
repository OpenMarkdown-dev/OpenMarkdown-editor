# 行内结构

结构键黄金用例(spec: structure-input / 行内结构里按 Enter 是「改完了」;change: inline-enter-commit)。`‸` 是光标。

光标在图片、链接、行内公式的源码**里面**时,Enter 不把它从中间切开,而是把光标送到下一行开头(没有下一行就新建一行);光标在源码边上(前面或后面)时照常换行。

## 图片尺寸里按 Enter:跳到下一行
keys: Enter

```md
![截图|30‸0](a.png)
下一段
```

```md
![截图|300](a.png)
‸下一段
```

## 图片是最后一行:新建一行
keys: Enter

```md
![截图|300](a.p‸ng)
```

```md
![截图|300](a.png)
‸
```

## 图片后面还有字:字留在原行
keys: Enter

```md
看 ![图|200](b.png‸) 这里
```

```md
看 ![图|200](b.png) 这里
‸
```

## 链接文字里按 Enter
keys: Enter

```md
[文‸档](https://openmarkdown.dev)
```

```md
[文档](https://openmarkdown.dev)
‸
```

## 链接网址里按 Enter
keys: Enter

```md
[文档](https://openmark‸down.dev)
下一行
```

```md
[文档](https://openmarkdown.dev)
‸下一行
```

## 行内公式里按 Enter
keys: Enter

```md
质能 $E = m‸c^2$
```

```md
质能 $E = mc^2$
‸
```

## 光标在图片后面:照常换行
keys: Enter

```md
![图|200](b.png)‸
```

```md
![图|200](b.png)
‸
```

## 光标在链接前面:照常换行
keys: Enter

```md
看 ‸[文档](https://openmarkdown.dev)
```

```md
看 
‸[文档](https://openmarkdown.dev)
```

## 列表项里的链接:跳到下一行,不续列表
keys: Enter

```md
- [文‸档](https://openmarkdown.dev)
- 第二项
```

```md
- [文档](https://openmarkdown.dev)
- ‸第二项
```

## 行内结构里 Tab 照旧归外层(列表缩进)
keys: Tab

```md
- 一
- [文‸档](https://openmarkdown.dev)
```

```md
- 一
	- [文‸档](https://openmarkdown.dev)
```
