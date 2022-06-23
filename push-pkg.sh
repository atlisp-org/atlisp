#!/usr/bin/sh
cd ~/atlisp/packages/$1
git add .
git commit -m "$2"
git push

