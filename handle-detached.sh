#!/bin/sh

git branch temp
git checkout main
git merge temp
git push
git branch -d temp
