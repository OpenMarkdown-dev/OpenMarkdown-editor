# 代码块

结构键黄金用例(spec: structure-input)。`‸` 是光标;外层用四个反引号,好让文档里装得下 fence。

## 未闭合 fence 行尾 Enter 自动闭合
keys: Enter

````md
```python‸
````

````md
```python
‸
```
````

## 已闭合的 fence 不再补闭合行
keys: Enter

````md
```python‸
x = 1
```
````

````md
```python
‸
x = 1
```
````

## 列表里的 fence 不自动闭合
keys: Enter

不补闭合行;change `quote-keys` 起新行续写列表项的缩进(以前掉回第 0 列)。

````md
- ```python‸
````

````md
- ```python
  ‸
````

## 引用里的 fence 不自动闭合
keys: Enter

不补闭合行;change `quote-keys` 起新行续写 `> `(以前掉回第 0 列)。

````md
> ```python‸
````

````md
> ```python
> ‸
````

## 代码块里 Tab 是默认缩进
keys: Tab

````md
```
x = 1‸
```
````

````md
```
  x = 1‸
```
````

## 列表项里的代码块 Tab 不动列表
keys: Tab

````md
1. a
2. b

   ```
   x = 1‸
   ```
````

````md
1. a
2. b

   ```
     x = 1‸
   ```
````


## 引用里的代码块 Enter 续写引用
keys: Enter

````md
> ```python
> x = 1‸
> ```
````

````md
> ```python
> x = 1
> ‸
> ```
````

## 列表里的代码块 Enter 续写缩进
keys: Enter

````md
- ```python
  x = 1‸
  ```
````

````md
- ```python
  x = 1
  ‸
  ```
````

## 引用里的代码块保留代码自己的缩进
keys: Enter

````md
> ```
>     x‸
> ```
````

````md
> ```
>     x
>     ‸
> ```
````

## 引用里的 fence 闭合行 Enter 留在引用
keys: Enter

````md
> ```
> x
> ```‸
````

````md
> ```
> x
> ```
> ‸
````

## 嵌套引用里的 fence 开头行
keys: Enter

````md
> > ```py‸
````

````md
> > ```py
> > ‸
````

## 列表里引用里的 fence 开头行
keys: Enter

````md
- > ```py‸
````

````md
- > ```py
  > ‸
````

## 引用里列表项的 fence 开头行
keys: Enter

````md
> - ```py‸
````

````md
> - ```py
>   ‸
````
