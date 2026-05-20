import Taro from '@tarojs/taro'
import { BASE_URL } from '../config'

const SESSION_TOKEN_KEY = 'task_app_cloud_session_token'

export const getSessionToken = () => {
  try {
    return Taro.getStorageSync(SESSION_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export const setSessionToken = (token) => {
  try {
    if (token) Taro.setStorageSync(SESSION_TOKEN_KEY, token)
    else Taro.removeStorageSync(SESSION_TOKEN_KEY)
  } catch {}
}

export const clearSessionToken = () => setSessionToken('')

function request(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const token = getSessionToken()
    const headers = {
      'Content-Type': 'application/json'
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    Taro.request({
      url: `${BASE_URL}${path}`,
      method,
      data: data || undefined,
      header: headers,
      success: (res) => {
        if (res.statusCode === 401) {
          clearSessionToken()
          reject(new Error('登录已失效，请重新登录'))
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error(res.data?.error || `请求失败: ${res.statusCode}`))
        }
      },
      fail: (err) => reject(err)
    })
  })
}

export const register = async ({ username, email, password }) => {
  const data = await request('/api/register', 'POST', { username, email, password })
  if (data?.token) setSessionToken(data.token)
  return data
}

export const login = async ({ identifier, password }) => {
  const data = await request('/api/login', 'POST', { identifier, password })
  if (data?.token) setSessionToken(data.token)
  return data
}

export const logout = async () => {
  try {
    await request('/api/logout', 'POST', {})
  } finally {
    clearSessionToken()
  }
}

export const getMe = () => request('/api/me')

// 获取全部数据
export const getData = () => request('/api/data')

// 保存全部数据
export const saveData = (data) => request('/api/data', 'POST', data)

// 新增任务
export const addTask = (task) => request('/api/tasks/add', 'POST', task)

// 更新任务
export const updateTask = (task) => request('/api/tasks/update', 'POST', task)

// 删除任务
export const deleteTask = (id) => request('/api/tasks/delete', 'POST', { id })

// 获取日记（今日 + 归档）
export const getDiary = () => request('/api/diary')

// 仅获取今日日记（轻量，启动时用）
export const getDiaryToday = () => request('/api/diary?today=1')

// 保存日记
export const saveDiary = (diary) => request('/api/diary', 'POST', diary)

// 新增笔记（原子接口，不影响任务数据）
export const addNote = (note) => request('/api/notes/add', 'POST', note)

// 删除笔记（原子接口）
export const deleteNote = (id) => request('/api/notes/delete', 'POST', { id })

// 更新笔记（原子接口）
export const updateNote = (note) => request('/api/notes/update', 'POST', note)
