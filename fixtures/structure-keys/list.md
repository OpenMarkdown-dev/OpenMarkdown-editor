# 列表:续行、marker、边界

结构键黄金用例(spec: structure-input、live-preview-editor)。`‸` 是光标。

## 无序项行尾 Enter 续一项
keys: Enter

```md
- 一项‸
```

```md
- 一项
- ‸
```

## 有序项行尾 Enter 续号
keys: Enter

```md
1. a‸
2. b
```

```md
1. a
2. ‸
3. b
```

## 任务项行尾 Enter 续一个空任务
keys: Enter

```md
- [ ] 一项‸
```

```md
- [ ] 一项
- [ ] ‸
```

## 空项 marker 后 Backspace 把 marker 换成空格
keys: Backspace

```md
- a
- ‸
```

```md
- a
  ‸
```

## 第一项 Tab 不动
keys: Tab

```md
1. a‸
2. b
```

```md
1. a‸
2. b
```

## 顶层项 Shift-Tab 不动
keys: Shift-Tab

```md
- a
- b‸
```

```md
- a
- b‸
```

## 有序末项 Tab 嵌成子列表从 1 开始
keys: Tab

```md
1. a
2. b
3. c‸
```

```md
1. a
2. b
	1. c‸
```

## 嵌套末项 Shift-Tab 回到上一层并续号
keys: Shift-Tab

```md
1. a
2. b
    1. c‸
```

```md
1. a
2. b
3. c‸
```

