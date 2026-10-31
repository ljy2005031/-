\# OriginClient 作业版



RoboMaster 风格地面站客户端，包含 Vue 3 前端、本地 MQTT 后端、协议模拟器和战场控制度面板。



\## 环境要求



\- Node.js 20+

\- npm 10+



\## 安装依赖



```bash

npm install

cd server

npm install

cd ../OriginClientProtocolSimulator

npm install

前端 MQTT 配置

项目根目录 .env.local：



VITE\_MQTT\_URL=ws://localhost:8083/mqtt

VITE\_MQTT\_USERNAME=

VITE\_MQTT\_PASSWORD=

VITE\_API\_BASE\_URL=http://localhost:8080/api

VITE\_MJPEG\_URL=http://127.0.0.1:8090/video.mjpg

启动本地后端

cd server

npm start

后端端口：



MQTT TCP：1883

MQTT WebSocket：8083

HTTP API：8080

后端同时启动 MQTT 桥接，把模拟器 3333 的 GameStatus、BuildingStatus、RobotDynamicStatus 转发到本地 1883/8083。



启动前端

另开终端，在项目根目录执行：



npm run dev

浏览器打开：



http://localhost:1420

启动模拟器

另开终端：



cd ../OriginClientProtocolSimulator

npm start

模拟器控制台：



http://127.0.0.1:9130

模拟器 MQTT Broker：



mqtt://127.0.0.1:3333

如果模拟器不在 ../OriginClientProtocolSimulator，修改根目录 package.json 中的 simulator 脚本路径，或直接进入模拟器目录执行 npm start。



演示顺序

重置比赛：发送 GameStatus，currentStage: 0

修改机器人血量：发送 RobotDynamicStatus，currentHealth: 50

前哨站击毁：发送 BuildingStatus，蓝方前哨站 health: 0、state: "destroyed"

正常比赛与控制度增长：

发送 BuildingStatus，红方占领两个前哨站

发送 GameStatus，currentStage: 4、isPaused: false

演示功能

2.1 地图更新：全屏遥测地图黄色静态文字标注

1.2 基地与前哨状态：归属方颜色切换、前哨血量 / 击毁 / 重建

1.3 旧功能退出：重装承接装配入口，旧空中支援默认停用

2.2 战场控制度：两个前哨站 +1/s，两个基地 +3/s，实时显示红蓝控制度、差值和增速

第 3 章：通过模拟器 MQTT 发送状态，客户端接收并展示

构建

npm run build

前端产物输出到 dist/。





