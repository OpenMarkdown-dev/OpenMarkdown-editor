# 引用与 callout

结构键黄金用例(spec: structure-input)。每节:原文 → 按 keys 里的键 → 期望原文;`‸` 是光标,`«…»` 是选区。

## 引用行尾 Enter 续行
keys: Enter

```md
> 一句话‸
```

```md
> 一句话
> ‸
```

## 引用里连按 Enter 退出引用
keys: Enter Enter

change `quote-keys` 起空引用行一次 Enter 就退出(Obsidian 手感),所以从三次改为两次:第一次续行,第二次在空的 `> ` 行上去掉 marker 退出。

```md
> 一句话‸
```

```md
> 一句话
‸
```

## 引用空行 Enter 退出引用
keys: Enter

```md
> 一句话
> ‸
```

```md
> 一句话
‸
```

## callout 正文 Enter 续行
keys: Enter

```md
> [!NOTE]
> 正文‸
```

```md
> [!NOTE]
> 正文
> ‸
```

## callout 空行 Enter 退出
keys: Enter

```md
> [!NOTE]
> 正文
> ‸
```

```md
> [!NOTE]
> 正文
‸
```

## 嵌套引用空行 Enter 回到上一层
keys: Enter

```md
> > 二层
> > ‸
```

```md
> > 二层
> ‸
```

## 嵌套引用连按 Enter 逐层退出
keys: Enter Enter Enter

```md
> > 二层‸
```

```md
> > 二层
‸
```

## 引用里 Tab 是默认缩进
keys: Tab

```md
> 一句话‸
```

```md
  > 一句话‸
```

## 引用空行 Backspace 删掉 marker
keys: Backspace

```md
> 一句话
> ‸
```

```md
> 一句话
‸
```

## 引用里的列表项 Enter 续项
keys: Enter

```md
> - 项‸
```

```md
> - 项
> - ‸
```

## 引用里的有序项 Enter 续号
keys: Enter

```md
> 1. 第一‸
```

```md
> 1. 第一
> 2. ‸
```

## 引用里的空列表项 Enter 退出列表、留在引用
keys: Enter

```md
> - 项
> - ‸
```

```md
> - 项
> ‸
```

## 引用里的空列表项连按 Enter 退出引用
keys: Enter Enter

```md
> - 项
> - ‸
```

```md
> - 项
‸
```

## 引用里的空有序项 Enter 退出列表
keys: Enter

```md
> 1. a
> 2. ‸
```

```md
> 1. a
> ‸
```

## 引用里的空嵌套项 Enter 回到上一层
keys: Enter

```md
> - 项
> 	- ‸
```

```md
> - 项
> - ‸
```

## 引用里空格写法的空嵌套项 Enter 回到上一层
keys: Enter

```md
> - 项
>   - ‸
```

```md
> - 项
> - ‸
```

## 引用里的列表 Tab 缩进在 marker 之后
keys: Tab

```md
> - 项
> - 二‸
```

```md
> - 项
> 	- 二‸
```

## 引用里的列表 Shift-Tab 反缩进
keys: Shift-Tab

```md
> - 项
> 	- 二‸
```

```md
> - 项
> - 二‸
```

## 引用里的列表 ⌘] 与 Tab 产出相同
keys: ⌘]

```md
> - 项
> - 二‸
```

```md
> - 项
> 	- 二‸
```

## 引用里的列表 ⌘[ 与 Shift-Tab 产出相同
keys: ⌘[

```md
> - 项
> 	- 二‸
```

```md
> - 项
> - 二‸
```

## 引用里的列表首项 Tab 不动
keys: Tab

```md
> - 项‸
```

```md
> - 项‸
```

## 引用里的空格列表 Tab 照它的写法
keys: Tab

```md
> - a
>   - b
> - c‸
```

```md
> - a
>   - b
>   - c‸
```

## 引用里的有序列表 Tab 从 1 重排
keys: Tab

`> ` 之后的 Tab 只推到第 4 列(Tab 停靠点按整行算),够不到 `2. ` 的内容列 5,所以写两个 Tab——与引用外宽 marker 写两个 Tab 同一条规则。

```md
> 1. a
> 2. b
> 3. c‸
```

```md
> 1. a
> 2. b
> 		1. c‸
```

## 引用里的列表 Tab 子树与续行跟随
keys: Tab

```md
> - a
> - b‸
>   续行
> 	- c
```

```md
> - a
> 	- b‸
> 	  续行
> 		- c
```

## 引用里的多行选区批量缩进
keys: Tab

```md
> - a
> «- b
> - c»
```

```md
> - a
> «	- b
> 	- c»
```
