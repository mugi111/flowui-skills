# ui-observer

## 概要
現在表示中のページを観測し、上限付きの観測結果を取得します。UIの意味判断や操作は担当しません。

## Purpose
Inspect visible, user-observable UI using `flowui inspect`.

## Procedure
Run inspection, preserve completeness metadata, and request a narrower inspection when data is partial.

## Rules
Do not execute actions. Do not treat omitted output as absent UI.
