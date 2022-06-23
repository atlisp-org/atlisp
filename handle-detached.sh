#!/bin/sh

git branch temp
git merge temp
git push
git branch -d temp
