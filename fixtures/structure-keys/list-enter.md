# 列表:空项回车

结构键黄金用例(spec: live-preview-editor / 列表结构操作)。`‸` 是光标。

## 空的嵌套项 Enter 回到上一层
keys: Enter

```md
- a
	- ‸
```

```md
- a
- ‸
```

## 空的嵌套项 Enter 与 Shift-Tab 产出相同
keys: Shift-Tab

```md
- a
	- ‸
```

```md
- a
- ‸
```

## 空的第二项 Enter 退出列表,不变成松散列表
keys: Enter

```md
- a
- ‸
```

```md
- a
‸
```

## 空的任务项 Enter 退出列表
keys: Enter

```md
- [ ] a
- [ ] ‸
```

```md
- [ ] a
‸
```

## 连按 Enter:续一项再退出
keys: Enter Enter

```md
- a‸
```

```md
- a
‸
```

## 嵌套项连按 Enter:续一项、回上一层、退出
keys: Enter Enter Enter

```md
- a
	- b‸
```

```md
- a
	- b
‸
```

## 有序嵌套空项 Enter 回上一层并续号
keys: Enter

```md
1. a
	1. b
	2. ‸
```

```md
1. a
	1. b
2. ‸
```
