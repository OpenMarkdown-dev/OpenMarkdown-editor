# 列表:缩进与反缩进

结构键黄金用例(spec: live-preview-editor / 列表结构操作)。`‸` 是光标,`«…»` 是选区。缩进里的 Tab 字符在编辑器里看不出来,用源码模式或 `cat -A` 核对。

## 有序末项 Tab 写一个 Tab 字符并从 1 编号
keys: Tab

```md
1. a
2. b
3. c
4. d‸
```

```md
1. a
2. b
3. c
	1. d‸
```

## ⌘] 与 Tab 产出相同
keys: ⌘]

```md
1. a
2. b
3. c
4. d‸
```

```md
1. a
2. b
3. c
	1. d‸
```

## Tab 写法的列表继续写 Tab
keys: Tab

```md
- a
	- b
	- c‸
```

```md
- a
	- b
		- c‸
```

## 宽 marker 之下写两个 Tab
keys: Tab

```md
100. a
101. b‸
```

```md
100. a
		1. b‸
```

## agent 写的空格列表按它的写法续写
keys: Tab

```md
1. 第一步
   - 细节
   - 细节2‸
```

```md
1. 第一步
   - 细节
      - 细节2‸
```

## 空格列表的新子层照抄别处第二层的步长
keys: Tab

```md
- a
  - b
- c
- d‸
```

```md
- a
  - b
- c
  - d‸
```

## 只改被移动的行
keys: Tab

```md
- a
  - b
- c
    - d
- e‸
```

```md
- a
  - b
- c
    - d
    - e‸
```

## 同一层 dash 与数字并存
keys: Tab

```md
- 你说呢
  - 哈哈
1. 下面可以有‸
```

```md
- 你说呢
  - 哈哈
  1. 下面可以有‸
```

## 子树跟着一起缩进
keys: Tab

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

## 续行跟着一起缩进
keys: Tab

```md
- a
- b‸
  续行
```

```md
- a
	- b‸
	  续行
```

## 无序与任务项嵌套不加序号、保留勾选
keys: Tab

```md
- [ ] a
- [x] b‸
```

```md
- [ ] a
	- [x] b‸
```

## 最外层保留起始数,嵌套层从 1
keys: Tab

```md
3. a
4. b
5. c‸
```

```md
3. a
4. b
	1. c‸
```

## 反缩进回父层,两侧各自重排
keys: Shift-Tab

```md
1. a
2. b
	1. c‸
	2. d
```

```md
1. a
2. b
3. c‸
	1. d
```

## ⌘[ 与 Shift-Tab 产出相同
keys: ⌘[

```md
1. a
2. b
	1. c‸
	2. d
```

```md
1. a
2. b
3. c‸
	1. d
```

## 序号变宽后子项仍是合法嵌套
keys: Shift-Tab

```md
1. a
2. b
	1. c‸
3. d
4. e
5. f
6. g
7. h
8. i
9. j
   - x
```

```md
1. a
2. b
3. c‸
4. d
5. e
6. f
7. g
8. h
9. i
10. j
	- x
```

## 多行选区批量缩进
keys: Tab

```md
- a
«- b
- c»
```

```md
- a
«	- b
	- c»
```

## 选区含首项时其余项照常缩进
keys: Tab

```md
«- a
- b»
```

```md
«- a
	- b»
```

## 选区全是顶层项时 Shift-Tab 不动
keys: Shift-Tab

```md
«- a
- b»
```

```md
«- a
- b»
```
