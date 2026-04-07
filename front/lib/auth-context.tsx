"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { apiMe } from '@/lib/api'

interface AuthContextType {
  isAuthenticated: boolean
  apiKey: string | null
  login: (key: string) => Promise<boolean>
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const verify = async () => {
      const savedKey = localStorage.getItem('jh_api_key')
      if (!savedKey) {
        setIsLoading(false)
        return
      }
      try {
        await apiMe()
        setApiKey(savedKey)
        setIsAuthenticated(true)
      } catch {
        localStorage.removeItem('jh_api_key')
        setApiKey(null)
        setIsAuthenticated(false)
      } finally {
        setIsLoading(false)
      }
    }
    void verify()
  }, [])

  const login = async (key: string): Promise<boolean> => {
    setIsLoading(true)
    const prev = localStorage.getItem('jh_api_key')
    localStorage.setItem('jh_api_key', key.trim())
    try {
      await apiMe()
      setApiKey(key.trim())
      setIsAuthenticated(true)
      return true
    } catch {
      if (prev) localStorage.setItem('jh_api_key', prev)
      else localStorage.removeItem('jh_api_key')
      setApiKey(null)
      setIsAuthenticated(false)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('jh_api_key')
    setApiKey(null)
    setIsAuthenticated(false)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, apiKey, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
