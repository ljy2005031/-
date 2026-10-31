<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, onActivated, onDeactivated } from 'vue'
import HudPanel from '@/components/HudPanel.vue'
import { useMqttDataStore } from '@/store/modules/mqtt_data'
import BattleControlPanel from '@/components/Dashboard/BattleControlPanel.vue'

type Team = 'red' | 'blue'
type Robot = {
  id: string
  team: Team
  x: number
  y: number
  hp: number
  // 渲染位置（用于插值）
  renderX?: number
  renderY?: number
  // 目标位置（实际逻辑位置）
  targetX?: number
  targetY?: number
}

const mapPanel = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
const mqttStore = useMqttDataStore()

const isBorderVisible = ref(false)
const isControlsModalVisible = ref(false)
// --- 新增: 边界框顶点和拖拽状态 ---
const handleRadius = 10 // 拖拽手柄的像素半径
const corners = reactive([
  { x: 0.1, y: 0.1 }, // 左上 (百分比)
  { x: 0.9, y: 0.1 }, // 右上
  { x: 0.9, y: 0.9 }, // 右下
  { x: 0.1, y: 0.9 } // 左下
])
const draggingCornerIndex = ref<number | null>(null)
// --- 结束 ---

const mapImage = ref<HTMLImageElement | null>(null)

// 插值参数：控制移动平滑度（0-1，越小越平滑但有延迟）
const LERP_FACTOR = 0.15

const robots = reactive<Robot[]>([])
const selectedId = ref<string | null>(null)
const simRunning = ref(true)
let rafHandle: number | null = null
let simInterval: number | null = null
let resizeObserver: ResizeObserver | null = null

const redTeamRobots = computed(() => robots.filter((r) => r.team === 'red'))
const blueTeamRobots = computed(() => robots.filter((r) => r.team === 'blue'))

// Initialize sample robots
function initSampleRobots() {
  robots.splice(0, robots.length)
  const ids = ['1', '2', '3', '4', '6', '7']
  // --- 新增: 获取边界框范围 ---
  const minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * 100
  const maxX = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * 100
  const minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * 100
  const maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * 100
  const rangeX = maxX - minX
  const rangeY = maxY - minY
  // --- 结束 ---

  // Red Team
  ids.forEach((id) => {
    const initX = Math.random() * (rangeX / 2) + minX
    const initY = Math.random() * rangeY + minY
    robots.push({
      id: `R${id}`,
      team: 'red',
      x: initX,
      y: initY,
      // 初始化渲染位置与实际位置相同
      renderX: initX,
      renderY: initY,
      targetX: initX,
      targetY: initY,
      hp: Math.floor(60 + Math.random() * 40)
    })
  })
  // Blue Team
  ids.forEach((id) => {
    const initX = Math.random() * (rangeX / 2) + (minX + rangeX / 2)
    const initY = Math.random() * rangeY + minY
    robots.push({
      id: `B${id}`,
      team: 'blue',
      x: initX,
      y: initY,
      // 初始化渲染位置与实际位置相同
      renderX: initX,
      renderY: initY,
      targetX: initX,
      targetY: initY,
      hp: Math.floor(60 + Math.random() * 40)
    })
  })
}

// Simulate robot movement and status changes
function simulateStep() {
  // --- 新增: 获取边界框范围 ---
  const minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * 100
  const maxX = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * 100
  const minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * 100
  const maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * 100
  // --- 结束 ---

  for (const r of robots) {
    // 更新目标位置（逻辑位置）
    const newX = Math.max(minX, Math.min(maxX, r.x + (Math.random() - 0.5) * 3))
    const newY = Math.max(minY, Math.min(maxY, r.y + (Math.random() - 0.5) * 3))

    r.x = newX
    r.y = newY
    r.targetX = newX
    r.targetY = newY

    // 初始化渲染位置（如果未设置）
    if (r.renderX === undefined) r.renderX = newX
    if (r.renderY === undefined) r.renderY = newY

    r.hp = Math.max(0, Math.min(100, r.hp + Math.floor((Math.random() - 0.52) * 2)))
  }
}

const startSimulation = () => {
  if (simInterval) clearInterval(simInterval)
  simRunning.value = true
  simInterval = window.setInterval(simulateStep, 500)
}

const stopSimulation = () => {
  if (simInterval) clearInterval(simInterval)
  simInterval = null
  simRunning.value = false
}

const toggleSim = () => (simRunning.value ? stopSimulation() : startSimulation())

const selectRobot = (id: string) => (selectedId.value = id)

function returnToDashboard(): void {
  const dashboardButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.dock-btn')
  ).find((button) => button.title === '图传' || button.textContent?.includes('图传'))

  if (dashboardButton) {
    dashboardButton.click()
    return
  }

  // 兜底：如果底部导航还没挂载，重新加载会回到默认 Dashboard。
  window.location.reload()
}

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' || event.code === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    document.exitPointerLock?.()
    returnToDashboard()
    return
  }

  if (event.key.toLowerCase() === 'p') {
    isBorderVisible.value = !isBorderVisible.value
  }
  // --- 新增: 'e' 键切换控制弹窗 ---
  if (event.key.toLowerCase() === 'e') {
    isControlsModalVisible.value = !isControlsModalVisible.value
  }
  // --- 结束 ---
}

const resizeCanvas = (): void => {
  const cvs = canvas.value
  const panel = mapPanel.value
  if (!cvs || !panel || !ctx) return

  const { width, height } = panel.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const displayWidth = Math.round(width)
  const displayHeight = Math.round(height)

  cvs.width = displayWidth * dpr
  cvs.height = displayHeight * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

// --- 新增：MapClickInfo 地图标记 ---
const MAP_CLICK_FIELD_WIDTH = 28
const MAP_CLICK_FIELD_HEIGHT = 15
const MAP_CLICK_MARKER_COLORS: Record<number, string> = {
  1: '#ef4444',
  2: '#3b82f6',
  3: '#f59e0b',
  4: '#eab308'
}

function mapClickInfoToCanvas(
  mapX: number,
  mapY: number,
  width: number,
  height: number
): { x: number; y: number } {
  const xMeters = Math.abs(mapX) > MAP_CLICK_FIELD_WIDTH ? mapX / 100 : mapX
  const yMeters = Math.abs(mapY) > MAP_CLICK_FIELD_HEIGHT ? mapY / 100 : mapY
  const bluePerspective = Number(mqttStore.currentRobotId) >= 100

  return bluePerspective
    ? {
        x: (1 - xMeters / MAP_CLICK_FIELD_WIDTH) * width,
        y: (1 - yMeters / MAP_CLICK_FIELD_HEIGHT) * height
      }
    : {
        x: (xMeters / MAP_CLICK_FIELD_WIDTH) * width,
        y: (yMeters / MAP_CLICK_FIELD_HEIGHT) * height
      }
}

function drawMapClickMarkers(
  currentCtx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  mqttStore.mapClickMarkers.forEach((marker) => {
    const { x, y } = mapClickInfoToCanvas(marker.mapX, marker.mapY, width, height)
    const color = MAP_CLICK_MARKER_COLORS[marker.type] ?? '#ef4444'
    const label = `#${marker.markerId} (${marker.mapX.toFixed(1)}, ${marker.mapY.toFixed(1)})`

    currentCtx.beginPath()
    currentCtx.arc(x, y, 9, 0, Math.PI * 2)
    currentCtx.fillStyle = color
    currentCtx.fill()
    currentCtx.strokeStyle = '#ffffff'
    currentCtx.lineWidth = 2
    currentCtx.stroke()

    currentCtx.font = 'bold 12px Arial'
    currentCtx.textAlign = 'left'
    currentCtx.textBaseline = 'middle'
    currentCtx.lineWidth = 3
    currentCtx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
    currentCtx.strokeText(label, x + 12, y - 10)
    currentCtx.fillStyle = '#ffffff'
    currentCtx.fillText(label, x + 12, y - 10)
  })
}

// --- 新增：静态地图标注 ---
const STATIC_MAP_ANNOTATIONS = [
  { name: '隧道', x: 0, y: 0 },
  { name: '制高点', x: -6, y: 3 },
  { name: '机库平台', x: -11, y: -4 },
  { name: '工作台', x: 11, y: 4 }
]

function staticWorldToCanvas(
  worldX: number,
  worldY: number,
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: ((worldX + MAP_CLICK_FIELD_WIDTH / 2) / MAP_CLICK_FIELD_WIDTH) * width,
    y: ((MAP_CLICK_FIELD_HEIGHT / 2 - worldY) / MAP_CLICK_FIELD_HEIGHT) * height
  }
}

function drawStaticMapAnnotations(
  currentCtx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  currentCtx.save()
  currentCtx.textAlign = 'center'
  currentCtx.textBaseline = 'middle'

  STATIC_MAP_ANNOTATIONS.forEach((annotation) => {
    const { x, y } = staticWorldToCanvas(annotation.x, annotation.y, width, height)

    // 静态点
    currentCtx.beginPath()
    currentCtx.arc(x, y, 5, 0, Math.PI * 2)
    currentCtx.fillStyle = '#facc15'
    currentCtx.fill()
    currentCtx.strokeStyle = '#ffffff'
    currentCtx.lineWidth = 1.5
    currentCtx.stroke()

    // 亮黄色文字 + 黑色描边
    const label = `[${annotation.name}]`
    currentCtx.font = 'bold 14px Arial'
    currentCtx.lineWidth = 4
    currentCtx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
    currentCtx.strokeText(label, x, y - 14)
    currentCtx.fillStyle = '#facc15'
    currentCtx.fillText(label, x, y - 14)
  })

  currentCtx.restore()
}

const draw = () => {
  const currentCtx = ctx
  const currentCanvas = canvas.value

  if (currentCtx && currentCanvas) {
    const { width, height } = currentCanvas.getBoundingClientRect()
    currentCtx.clearRect(0, 0, width, height)

    // --- 绘制地图背景 ---
    if (mapImage.value) {
      currentCtx.drawImage(mapImage.value, 0, 0, width, height)
    } else {
      currentCtx.fillStyle = '#061226'
      currentCtx.fillRect(0, 0, width, height)
    }

    // Draw grid over the map
    currentCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
    currentCtx.lineWidth = 1
    for (let i = 0; i < 10; i++) {
      currentCtx.beginPath()
      currentCtx.moveTo((i / 10) * width, 0)
      currentCtx.lineTo((i / 10) * width, height)
      currentCtx.stroke()
      currentCtx.beginPath()
      currentCtx.moveTo(0, (i / 10) * height)
      currentCtx.lineTo(width, (i / 10) * height)
      currentCtx.stroke()
    }

    // --- 绘制可拖拽的场地边界 ---
    if (isBorderVisible.value) {
      currentCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      currentCtx.lineWidth = 3
      currentCtx.fillStyle = 'rgba(255, 255, 255, 1)'

      // 绘制连接线
      currentCtx.beginPath()
      currentCtx.moveTo(corners[0].x * width, corners[0].y * height)
      for (let i = 1; i < corners.length; i++) {
        currentCtx.lineTo(corners[i].x * width, corners[i].y * height)
      }
      currentCtx.closePath()
      currentCtx.stroke()

      // 绘制拖拽手柄
      for (let i = 0; i < corners.length; i++) {
        currentCtx.beginPath()
        currentCtx.arc(corners[i].x * width, corners[i].y * height, handleRadius, 0, Math.PI * 2)
        currentCtx.fill()
      }
    }
    // --- 结束 ---

    // --- 新增：绘制静态地图标注 ---
    drawStaticMapAnnotations(currentCtx, width, height)

    // 更新机器人插值位置（在每一帧中平滑移动）
    robots.forEach((robot) => {
      if (robot.targetX !== undefined && robot.targetY !== undefined) {
        // 线性插值（lerp）：renderPos = renderPos + (targetPos - renderPos) * factor
        robot.renderX = robot.renderX! + (robot.targetX - robot.renderX!) * LERP_FACTOR
        robot.renderY = robot.renderY! + (robot.targetY - robot.renderY!) * LERP_FACTOR
      }
    })

    // Draw robots
    robots.forEach((robot) => {
      // 使用插值后的渲染位置
      const px = ((robot.renderX ?? robot.x) / 100) * width
      const py = ((robot.renderY ?? robot.y) / 100) * height
      const isSelected = selectedId.value === robot.id
      const radius = isSelected ? 8 : 6

      // --- 高亮选中单位 ---
      if (isSelected) {
        const pulseTime = Date.now() / 500
        const pulseRadius = radius + 4 + Math.sin(pulseTime) * 2
        const pulseOpacity = 0.5 + Math.sin(pulseTime) * 0.2

        currentCtx.beginPath()
        currentCtx.strokeStyle = `rgba(${
          robot.team === 'red' ? '248, 113, 113' : '96, 165, 250'
        }, ${pulseOpacity})`
        currentCtx.lineWidth = 3
        currentCtx.arc(px, py, pulseRadius, 0, Math.PI * 2)
        currentCtx.stroke()
      }
      // --- 结束 ---

      currentCtx.beginPath()
      currentCtx.fillStyle = robot.team === 'red' ? '#f87171' : '#60a5fa'
      currentCtx.arc(px, py, radius, 0, Math.PI * 2)
      currentCtx.fill()

      const labelText = `${robot.id} | ${robot.hp}%`
      currentCtx.font = 'bold 11px Arial'
      const textMetrics = currentCtx.measureText(labelText)
      const labelWidth = textMetrics.width + 10
      const labelHeight = 18
      const labelX = px + radius + 4
      const labelY = py - labelHeight / 2

      currentCtx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      currentCtx.fillRect(labelX, labelY, labelWidth, labelHeight)
      currentCtx.fillStyle = robot.team === 'red' ? '#fecaca' : '#bfdbfe'
      currentCtx.textBaseline = 'middle'
      currentCtx.fillText(labelText, labelX + 5, py)
    })

    // --- 新增：绘制 MQTT 地图点击标记 ---
    drawMapClickMarkers(currentCtx, width, height)
  }
  rafHandle = requestAnimationFrame(draw)
}

// --- 新增: 将 CSS 坐标转换为 Canvas 坐标 ---
function getMousePos(event: MouseEvent): { x: number; y: number } | null {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }
}

// --- 新增: 鼠标按下事件处理 ---
const handleMouseDown = (event: MouseEvent) => {
  if (!isBorderVisible.value || !canvas.value) return
  const pos = getMousePos(event)
  if (!pos) return

  const { width, height } = canvas.value.getBoundingClientRect()

  for (let i = 0; i < corners.length; i++) {
    const cornerX = corners[i].x * width
    const cornerY = corners[i].y * height
    const distance = Math.sqrt(Math.pow(pos.x - cornerX, 2) + Math.pow(pos.y - cornerY, 2))
    if (distance < handleRadius) {
      draggingCornerIndex.value = i
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      break
    }
  }
}

// --- 新增: 鼠标移动事件处理 ---
const handleMouseMove = (event: MouseEvent) => {
  if (draggingCornerIndex.value === null || !canvas.value) return

  const pos = getMousePos(event)
  if (!pos) return

  const { width, height } = canvas.value.getBoundingClientRect()

  // 将坐标限制在 0-1 范围内
  const newX = Math.max(0, Math.min(1, pos.x / width))
  const newY = Math.max(0, Math.min(1, pos.y / height))

  const index = draggingCornerIndex.value

  // 定义对角顶点的索引
  const oppositeIndex = (index + 2) % 4
  const oppositeCorner = corners[oppositeIndex]

  // 获取由拖动点和对角点定义的矩形边界
  let minX = Math.min(newX, oppositeCorner.x)
  let maxX = Math.max(newX, oppositeCorner.x)
  let minY = Math.min(newY, oppositeCorner.y)
  let maxY = Math.max(newY, oppositeCorner.y)

  // 根据新的边界重新计算所有四个顶点的位置
  corners[0] = { x: minX, y: minY } // 左上
  corners[1] = { x: maxX, y: minY } // 右上
  corners[2] = { x: maxX, y: maxY } // 右下
  corners[3] = { x: minX, y: maxY } // 左下
}

// --- 新增: 鼠标松开事件处理 ---
const handleMouseUp = () => {
  if (draggingCornerIndex.value !== null) {
    // --- 新增: 保存边界数据 ---
    window.api.setBoundaryCorners(JSON.parse(JSON.stringify(corners)))
    // --- 结束 ---
  }
  draggingCornerIndex.value = null
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
}

// --- 新增: 重置边界框到默认位置 ---
const resetBoundary = () => {
  const defaultCorners = [
    { x: 0.1, y: 0.1 }, // 左上
    { x: 0.9, y: 0.1 }, // 右上
    { x: 0.9, y: 0.9 }, // 右下
    { x: 0.1, y: 0.9 } // 左下
  ]
  corners.splice(0, corners.length, ...defaultCorners)
  // 保存重置后的默认值
  window.api.setBoundaryCorners(JSON.parse(JSON.stringify(corners)))
}
// --- 结束 ---

onMounted(async () => {
  // --- 新增: 加载已保存的边界数据 ---
  const savedCorners = await window.api.getBoundaryCorners()
  if (savedCorners && savedCorners.length === 4) {
    corners.splice(0, corners.length, ...savedCorners)
  }
  // --- 结束 ---

  // --- 新增: 加载地图图片 ---
  const img = new Image()
  img.src = '/Map.png'
  img.onload = () => {
    mapImage.value = img
  }
  img.onerror = (err) => {
    console.error('Failed to load map image:', err)
  }
  // --- 结束 ---
  if (canvas.value) {
    ctx = canvas.value.getContext('2d')
    resizeCanvas()
    resizeObserver = new ResizeObserver(resizeCanvas)
    if (mapPanel.value) {
      resizeObserver.observe(mapPanel.value)
    }
  }
  initSampleRobots()
  startSimulation()
  draw()
  // --- 新增: 为拖拽功能添加事件监听 ---
  if (canvas.value) {
    canvas.value.addEventListener('mousedown', handleMouseDown)
  }
  // --- 结束 ---
})

onUnmounted(() => {
  if (rafHandle) cancelAnimationFrame(rafHandle)
  stopSimulation()
  if (resizeObserver && mapPanel.value) {
    resizeObserver.unobserve(mapPanel.value)
  }
  // --- 新增: 移除事件监听 ---
  if (canvas.value) {
    canvas.value.removeEventListener('mousedown', handleMouseDown)
  }
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  // --- 结束 ---
})

// --- 新增: 处理组件激活/非激活状态 ---
onActivated(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onDeactivated(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div class="-root">
    <div class="map-panel" ref="mapPanel">
      <button
        class="telemetry-return-btn"
        type="button"
        title="返回主界面（ESC）"
        aria-label="返回主界面"
        @click="returnToDashboard"
      >
        <span class="telemetry-return-icon">←</span>
        <span>返回主界面</span>
        <kbd>ESC</kbd>
      </button>

      <canvas ref="canvas"></canvas>

      <!-- 新增: 战场控制度面板 -->
      <BattleControlPanel />

      <!-- 新增: 提示文字 -->
      <div class="hint">
        <span>按 E 打开设置菜单</span>
        <span class="separator">|</span>
        <span>按 P 绘制虚拟边界</span>
      </div>

      <!-- 修改: 移除 controls-container -->

      <div class="legend">
        <div class="legend-item"><span class="dot red"></span> 红队</div>
        <div class="legend-item"><span class="dot blue"></span> 蓝队</div>
      </div>

      <!-- 新增: 控制功能弹窗 -->
      <Transition name="modal-fade">
        <div
          v-if="isControlsModalVisible"
          class="modal-backdrop"
          @click="isControlsModalVisible = false"
        >
          <div class="modal-content" style="width: 280px" @click.stop>
            <h4>功能控制</h4>
            <div class="modal-actions" style="flex-direction: column; gap: 12px">
              <button class="modal-button-secondary" @click="toggleSim">
                {{ simRunning ? '停止模拟' : '启动模拟' }}
              </button>
              <button class="modal-button-secondary" @click="resetBoundary">重置边界</button>
            </div>
          </div>
        </div>
      </Transition>
      <!-- 结束 -->

      <HudPanel
        title="红队状态"
        team="red"
        :initial-style="{ top: '12px', left: '12px', width: '280px' }"
      >
        <div class="-panel-body">
          <div class="list">
            <div
              v-for="r in redTeamRobots"
              :key="r.id"
              :class="{ 'robot-row': true, selected: selectedId === r.id }"
              @click="selectRobot(r.id)"
            >
              <span class="badge" :class="r.team">{{ r.id }}</span>
              <div class="meta">
                <span>HP: {{ r.hp }}%</span>
                <span>Pos: ({{ r.x.toFixed(1) }}, {{ r.y.toFixed(1) }})</span>
              </div>
            </div>
          </div>
        </div>
      </HudPanel>

      <HudPanel
        title="蓝队状态"
        team="blue"
        :initial-style="{ top: '12px', right: '12px', width: '280px' }"
      >
        <div class="-panel-body">
          <div class="list">
            <div
              v-for="r in blueTeamRobots"
              :key="r.id"
              :class="{ 'robot-row': true, selected: selectedId === r.id }"
              @click="selectRobot(r.id)"
            >
              <span class="badge" :class="r.team">{{ r.id }}</span>
              <div class="meta">
                <span>HP: {{ r.hp }}%</span>
                <span>Pos: ({{ r.x.toFixed(1) }}, {{ r.y.toFixed(1) }})</span>
              </div>
            </div>
          </div>
        </div>
      </HudPanel>
    </div>
  </div>
</template>

<style scoped>
.-root {
  width: 100%;
  height: 100%;
}
.map-panel {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.telemetry-return-btn {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 9999;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 18px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 12px;
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
  color: #fff;
  font: inherit;
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  box-shadow:
    0 8px 26px rgba(239, 68, 68, 0.6),
    0 0 0 3px rgba(239, 68, 68, 0.18);
  animation: telemetry-return-pulse 1.6s ease-in-out infinite;
}

.telemetry-return-btn:hover {
  transform: translateY(-1px);
  background: linear-gradient(135deg, #f87171 0%, #dc2626 100%);
  box-shadow:
    0 10px 30px rgba(239, 68, 68, 0.75),
    0 0 0 4px rgba(239, 68, 68, 0.22);
}

.telemetry-return-btn:active {
  transform: translateY(0);
}

.telemetry-return-icon {
  font-size: 20px;
  line-height: 1;
}

.telemetry-return-btn kbd {
  padding: 3px 6px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

@keyframes telemetry-return-pulse {
  0%,
  100% {
    box-shadow:
      0 8px 26px rgba(239, 68, 68, 0.6),
      0 0 0 3px rgba(239, 68, 68, 0.18);
  }
  50% {
    box-shadow:
      0 10px 32px rgba(239, 68, 68, 0.8),
      0 0 0 6px rgba(239, 68, 68, 0.08);
  }
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.legend {
  position: absolute;
  left: 12px;
  top: 12px;
  display: flex;
  gap: 8px;
  z-index: 20;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.36);
  border-radius: 6px;
  font-size: 13px;
  color: #dbeafe;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot.red {
  background: #f87171;
}
.dot.blue {
  background: #60a5fa;
}

/* --- 新增: 提示文字样式 --- */
.hint {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.38);
  font-size: 12px;
  z-index: 50;
  display: flex;
  gap: 12px;
  user-select: none;
  white-space: nowrap;
}

.separator {
  color: rgba(255, 255, 255, 0.15);
}
/* --- 结束 --- */

/* --- DELETED: Controls modal styles moved to modals.css --- */

/* --- DELETED: Button group styles moved to modals.css --- */

.-panel-body .list {
  /* No margin needed as it's the only element */
}

.robot-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px;
  border-radius: 6px;
  margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
}
.robot-row.selected {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.14), rgba(244, 63, 94, 0.06));
}
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 28px;
  border-radius: 6px;
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
}
.badge.red {
  background: #f87171;
}
.badge.blue {
  background: #60a5fa;
}
.meta {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #cbd5e1;
  gap: 2px;
}
</style>