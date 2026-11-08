# 列表:折叠项上的结构键

结构键黄金用例(spec: live-preview-editor / 列表折叠)。`‸` 是光标;`fold:` 是按键前处于折叠态的项所在行,`fold-after:` 是按键后仍须折叠的行。

## 折叠项行尾 Enter 在整棵子树之后新起同级项
keys: Enter
fold: 1
fold-after: 1

```md
- a‸
  - b
  - c
- d
```

```md
- a
  - b
  - c
- ‸
- d
```

## 有序折叠项 Enter 续号,后面的同级项跟着改号
keys: Enter
fold: 1
fold-after: 1

```md
1. a‸
   - b
2. c
```

```md
1. a
   - b
2. ‸
3. c
```

## 折叠的任务项 Enter 新起空任务
keys: Enter
fold: 1
fold-after: 1

```md
- [ ] a‸
  - b
```

```md
- [ ] a
  - b
- [ ] ‸
```

## 嵌套的折叠项 Enter 在它自己的子树之后
keys: Enter
fold: 2
fold-after: 2

```md
- a
	- b‸
		- c
- d
```

```md
- a
	- b
		- c
	- ‸
- d
```

## 折叠项 Tab 整棵子树跟随且仍折叠
keys: Tab
fold: 2
fold-after: 2

```md
- a
- b‸
  - c
```

```md
- a
  - b‸
    - c
```

## 折叠项 Shift-Tab 整棵子树跟随且仍折叠
keys: Shift-Tab
fold: 2
fold-after: 2

```md
- a
	- b‸
		- c
```

```md
- a
- b‸
	- c
```

## 没折叠时行尾 Enter 照旧续一项
keys: Enter
fold: 
fold-after: 

```md
- a‸
  - b
```

```md
- a
- ‸
  - b
```

## 引用里的折叠项 Enter 在子树之后、写上引用前缀
keys: Enter
fold: 1
fold-after: 1

```md
> - a‸
>   - b
> - d
```

```md
> - a
>   - b
> - ‸
> - d
```

## callout 里的折叠项 Tab 整棵子树跟随且仍折叠
keys: Tab
fold: 3
fold-after: 3

```md
> [!NOTE]
> - a
> - b‸
>   - c
```

```md
> [!NOTE]
> - a
>   - b‸
>     - c
```
