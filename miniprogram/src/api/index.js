import Taro from '@tarojs/taro'
import { API_TOKEN } from '../config'

const BASE_URL = 'https://yangminggu.com/tasks'

function request(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    Taro.request({
      url: `${BASE_URL}${path}`,
      method,
      data: data || undefined,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`
      },
      success: (res) => {
        if (res.statusCode === 401) {
          reject(new Error('认证失败，请检查 API Token'))
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error(`请求失败: ${res.statusCode}`))
        }
      },
      fail: (err) => reject(err)
    })
  })
}

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
