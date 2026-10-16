// serverLibrary 在求值依赖时就可能被动态 import 的回调重入。
// 模块级 let 此时还在暂时性死区，访问会抛 ReferenceError。这个对象没有依赖，先初始化完成。
export const serverLibraryGate = { enabled: false }
