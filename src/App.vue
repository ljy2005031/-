<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, provide } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Dashboard from './views/Dashboard.vue'
import Telemetry from './views/Telemetry.vue'
import Settings from './views/Settings.vue'
import CustomDataConfig from './views/CustomDataConfig.vue'
import StatusBar from './components/StatusBar.vue'
import MqttAutoConnect from './components/MqttAutoConnect.vue'
import { useDashboardStore } from './store'
import { useMqttDataStore } from './store/modules/mqtt_data'
import { storeToRefs } from 'pinia'

type Tab = 'Dashboard' | 'Telemetry' | 'Settings' | 'CustomData'
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'Dashboard', label: '图传', icon: '🏁' },
  { id: 'Telemetry', label: '遥测', icon: '📡' },
  { id: 'CustomData', label: '自定义数据', icon: '📦' },
  { id: 'Settings', label: '设置', icon: '⚙️' }
]
const current = ref<Tab>('Dashboard')

const components = {
  Dashboard,
  Telemetry,
  CustomData: CustomDataConfig,
  Settings
}

// 使用 Pinia store 管理状态
const store = useDashboardStore()
const { isDrawingMode, isDebugMode } = storeToRefs(store)

const mqttDataStore = useMqttDataStore()

const debugRobotHealth = computed(() => {
  const robotId = mqttDataStore.currentRobotId
  const robot = robotId > 0
    ? mqttDataStore.getRobot(robotId)
    : mqttDataStore.allRobots.find((item) => item.lastUpdate > 0)

  return robot?.currentHealth ?? '--'
})

const isMqttConnected = computed(() => store.globalState.mqttStatus === 'connected')

const isFullScreen = ref(true)
let cleanupListener: (() => void) | null = null

// 修改: 更新计算属性以包含 Telemetry 和 MapView3D 页面
const isFullScreenContentActive = computed(() =>
  ['Dashboard', 'Telemetry'].includes(current.value)
)

// 监听 current tab 变化，更新 store 中的 showRemainingTime
const updateShowRemainingTime = () => {
  store.showRemainingTime = current.value === 'Dashboard'
}

// 提供给子组件的方法（保持向后兼容）
const updateScore = (team: 'red' | 'blue', increment: number) => {
  store.updateScore(team, increment)
}

const resetScore = () => {
  store.resetScore()
}

// 更新机器人状态（供 Dashboard 调用）
const updateRobotStatus = (updates: Record<string, unknown>) => {
  store.updateRobotStatusFlags(updates)
}

// Provide methods to child components（保持向后兼容）
provide('statusBarMethods', {
  updateScore,
  resetScore
})

// 提供机器人状态和更新方法给子组件（保持向后兼容，指向 store）
provide(
  'robotStatus',
  computed(() => store.robotStatusFlags)
)
provide('updateRobotStatus', updateRobotStatus)

onMounted(() => {
  if (mqttDataStore.currentRobotId === 0) {
    mqttDataStore.serverSelectedRobotId = 1
  }

  cleanupListener = window.api.onMaximizedStateChanged?.((state) => {
    isFullScreen.value = state
  }) ?? null
  updateShowRemainingTime()
  window.addEventListener('keydown', onKeyDown, { capture: true })
})

onUnmounted(() => {
  if (cleanupListener) {
    cleanupListener()
  }
  window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
})

// 调试模式下按 F12 打开开发者工具（避免普通用户误触）
function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key === 'F12' && !ev.repeat && isDebugMode.value) {
    ev.preventDefault()
    ev.stopPropagation()
    window.api.openDevTools?.()
  }
}

function selectTab(t: Tab): void {
  current.value = t
  updateShowRemainingTime()
}
</script>

<template>
  <div id="app-root" :class="{ 'fullscreen-content-active': isFullScreenContentActive }">
    <StatusBar v-show="!isDrawingMode" />
    <MqttAutoConnect />
    <div
      class="mqtt-connection-indicator"
      :class="{ connected: isMqttConnected }"
    >
      <span class="mqtt-status-dot"></span>
      <span>{{ isMqttConnected ? '已连接' : '重连中...' }}</span>
    </div>
    <div class="debug-health-overlay">
      [调试] 当前测试血量: {{ debugRobotHealth }}
    </div>
    <TitleBar v-if="!isFullScreen" />
    <div class="app-content-wrapper">
      <main :class="['content', { 'no-padding': isFullScreenContentActive }]">
        <keep-alive>
          <component :is="components[current]" />
        </keep-alive>
      </main>

      <div class="dock-wrapper">
        <nav class="dock">
          <button
            v-for="t in tabs"
            :key="t.id"
            :class="{ 'dock-btn': true, active: current === t.id }"
            :title="t.label"
            @click="selectTab(t.id)"
          >
            <span class="icon">{{ t.icon }}</span>
            <span class="label">{{ t.label }}</span>
          </button>
        </nav>
      </div>
    </div>
  </div>
</template>

<style scoped>
#app-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--color-text);
  overflow: hidden;
}

.app-content-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  min-height: 0;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.content.no-padding {
  padding: 0;
  overflow: hidden;
}

/* 自动隐藏 Dock 的容器 */
.dock-wrapper {
  position: fixed;
  bottom: 0;
  /* 修改: 将触发区域从全屏宽度改为居中的固定宽度 */
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  /* 结束修改 */
  display: flex;
  justify-content: center;
  padding-bottom: 5px;
  z-index: 100;
}

.dock {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 14px;
  height: 56px;
  border-radius: 20px;
  background-color: rgba(25, 28, 38, 0.3);
  backdrop-filter: blur(30px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.05);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  transform: translateY(calc(100% + 10px));
}

.dock-wrapper:hover .dock {
  transform: translateY(0);
}

.dock-btn {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  border: none;
  color: rgba(235, 235, 245, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  outline: none;
  background: transparent;
  position: relative;
  z-index: 1;
  transition: color 0.25s ease;
}

.dock-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background-color: #2d3748;
  border: 1px solid rgba(124, 139, 161, 0.2);
  z-index: -1;
  opacity: 0;
  transform: scale(0.9);
  transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.dock-btn.active::before {
  opacity: 1;
  transform: scale(1);
}

.dock-btn.active {
  color: #c4dfff;
}

.dock-btn:not(.active):hover {
  color: white;
}

.icon {
  font-size: 20px;
  line-height: 1;
}

.label {
  position: absolute;
  bottom: 68px;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 10px;
  white-space: nowrap;
  background-color: rgba(25, 28, 38, 0.3);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.05);
  color: #fff;
  pointer-events: none;
  opacity: 0;
  transform: translateY(10px) scale(0.9);
  transition:
    opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.dock-btn:hover .label {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.debug-health-overlay {
  position: fixed;
  right: 16px;
  bottom: 72px;
  z-index: 9999;
  padding: 6px 10px;
  border: 1px solid rgba(250, 204, 21, 0.28);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.58);
  color: #facc15;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  pointer-events: none;
  white-space: nowrap;
  backdrop-filter: blur(6px);
}

.mqtt-connection-indicator {
  position: fixed;
  top: 8px;
  right: 12px;
  z-index: 10000;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.52);
  color: #fca5a5;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.04em;
  pointer-events: none;
  backdrop-filter: blur(6px);
}

.mqtt-connection-indicator.connected {
  color: #86efac;
  border-color: rgba(74, 222, 128, 0.25);
}

.mqtt-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 7px rgba(239, 68, 68, 0.9);
}

.mqtt-connection-indicator.connected .mqtt-status-dot {
  background: #22c55e;
  box-shadow: 0 0 7px rgba(34, 197, 94, 0.9);
}
</style>