# 嵌套容器

结构键黄金用例(spec: structure-input / 容器前缀续写,change `quote-keys`)。引用套列表、列表套引用、多层引用:新行续写的前缀都由同一个「容器前缀」推出。`‸` 是光标。

## 列表里的引用 Enter 续引用
keys: Enter

```md
- > 引用‸
```

```md
- > 引用
  > ‸
```

## 列表里的引用空行 Enter 回到列表项
keys: Enter

```md
- > 引用
  > ‸
```

```md
- > 引用
  ‸
```

## 嵌套引用里的列表项 Enter 续项
keys: Enter

```md
> > - 项‸
```

```md
> > - 项
> > - ‸
```

## 嵌套引用里的空列表项 Enter 留在引用
keys: Enter

```md
> > - 项
> > - ‸
```

```md
> > - 项
> > ‸
```

## 嵌套引用里的空列表项连按 Enter 逐层退出
keys: Enter Enter Enter

```md
> > - 项
> > - ‸
```

```md
> > - 项
‸
```

## 嵌套引用里的空嵌套项 Enter 回到上一层
keys: Enter

```md
> > - 项
> > 	- ‸
```

```md
> > - 项
> > - ‸
```

## 嵌套引用里的列表 Tab
keys: Tab

```md
> > - 项
> > - 二‸
```

```md
> > - 项
> > 	- 二‸
```

## 嵌套引用里的列表 Shift-Tab
keys: Shift-Tab

```md
> > - 项
> > 	- 二‸
```

```md
> > - 项
> > - 二‸
```

## 列表里引用里的列表 Tab
keys: Tab

```md
- > - a
  > - b‸
```

```md
- > - a
  > 	- b‸
```

## 列表里引用里的空列表项 Enter
keys: Enter

```md
- > - a
  > - ‸
```

```md
- > - a
  > ‸
```
