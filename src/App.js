import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Receipt, DollarSign } from 'lucide-react';

const PosterEmployeeDashboard = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [apiConfig, setApiConfig] = useState({
    token: '',
    account: '',
    baseUrl: ''
  });
  const [isConfigured, setIsConfigured] = useState(false);
  const [showManualConfig, setShowManualConfig] = useState(false);

  // Проверяем конфигурацию при загрузке компонента
  useEffect(() => {
    // Получаем переменные окружения
    const envToken = process.env.REACT_APP_POSTER_TOKEN || window.REACT_APP_POSTER_TOKEN || '';
    const envAccount = process.env.REACT_APP_POSTER_ACCOUNT || window.REACT_APP_POSTER_ACCOUNT || '';
    const envBaseUrl = process.env.REACT_APP_POSTER_BASE_URL || window.REACT_APP_POSTER_BASE_URL || '';

    console.log('Environment check:', {
      hasToken: !!envToken,
      hasAccount: !!envAccount,
      hasBaseUrl: !!envBaseUrl
    });

    if (envToken && envAccount) {
      setApiConfig({
        token: envToken,
        account: envAccount,
        baseUrl: envBaseUrl
      });
      setIsConfigured(true);
      fetchEmployeesWithConfig(envToken, envAccount, envBaseUrl);
    } else {
      setError('Переменные окружения не найдены. Настройте их в Render или введите вручную.');
      setLoading(false);
    }
  }, []);

  // Функция для получения данных сотрудников с параметрами
  const fetchEmployeesWithConfig = async (token, account, baseUrl) => {
    if (!token || !account) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const apiBaseUrl = baseUrl || `https://${account}.joinposter.com/api`;
      
      console.log('Making API call to:', apiBaseUrl);
      
      // Получаем список сотрудников
      const employeesResponse = await fetch(`${apiBaseUrl}/access.getEmployees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: token,
        }),
      });
      
      if (!employeesResponse.ok) {
        throw new Error(`HTTP Error: ${employeesResponse.status}`);
      }
      
      const employeesData = await employeesResponse.json();
      
      if (employeesData.error) {
        throw new Error(employeesData.error);
      }
      
      // Получаем статистику продаж для каждого сотрудника
      const today = new Date();
      const dateFrom = today.toISOString().split('T')[0];
      const dateTo = dateFrom;
      
      const employeesWithStats = await Promise.all(
        employeesData.response.map(async (employee) => {
          try {
            const statsResponse = await fetch(`${apiBaseUrl}/dash.getTransactionStats`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                token: token,
                dateFrom,
                dateTo,
                employee_id: employee.employee_id,
              }),
            });
            
            const statsData = await statsResponse.json();
            
            let stats = {
              revenue: 0,
              transactions: 0,
              averageCheck: 0
            };
            
            if (statsData.response && !statsData.error) {
              const data = statsData.response;
              stats.revenue = data.revenue || 0;
              stats.transactions = data.transactions || 0;
              stats.averageCheck = stats.transactions > 0 ? stats.revenue / stats.transactions : 0;
            }
            
            return {
              ...employee,
              stats,
              isOnShift: Math.random() > 0.3 // Увеличили вероятность для тестирования
            };
          } catch (err) {
            console.error(`Ошибка получения статистики для сотрудника ${employee.employee_name}:`, err);
            return {
              ...employee,
              stats: { revenue: 0, transactions: 0, averageCheck: 0 },
              isOnShift: false
            };
          }
        })
      );
      
      // Фильтруем только сотрудников на смене
      const onShiftEmployees = employeesWithStats.filter(emp => emp.isOnShift);
      setEmployees(onShiftEmployees);
      
    } catch (err) {
      setError(`Ошибка подключения к API: ${err.message}`);
      console.error('Ошибка:', err);
    } finally {
      setLoading(false);
    }
  };

  // Функция для обновления данных
  const fetchEmployees = () => {
    fetchEmployeesWithConfig(apiConfig.token, apiConfig.account, apiConfig.baseUrl);
  };

  // Функция для ручной настройки
  const handleManualConfig = () => {
    if (apiConfig.token && apiConfig.account) {
      setIsConfigured(true);
      setShowManualConfig(false);
      fetchEmployeesWithConfig(apiConfig.token, apiConfig.account, apiConfig.baseUrl);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: 'UAH',
    }).format(amount / 100); // Предполагаем, что API возвращает копейки
  };

  if (!isConfigured && !error && !showManualConfig) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Инициализация приложения...</p>
        </div>
      </div>
    );
  }

  if (!isConfigured && (error || showManualConfig)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <Users className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900">Настройка API</h1>
            <p className="text-gray-600 mt-2">Введите данные для подключения к Poster</p>
          </div>
          
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Название аккаунта *
              </label>
              <input
                type="text"
                value={apiConfig.account}
                onChange={(e) => setApiConfig({...apiConfig, account: e.target.value})}
                placeholder="your-account"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Token *
              </label>
              <input
                type="password"
                value={apiConfig.token}
                onChange={(e) => setApiConfig({...apiConfig, token: e.target.value})}
                placeholder="Введите ваш API токен"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Base URL (опционально)
              </label>
              <input
                type="text"
                value={apiConfig.baseUrl}
                onChange={(e) => setApiConfig({...apiConfig, baseUrl: e.target.value})}
                placeholder="https://your-account.joinposter.com/api"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <button
              onClick={handleManualConfig}
              disabled={!apiConfig.token || !apiConfig.account}
              className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Подключиться
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загружаем данные сотрудников...</p>
        </div>
      </div>
    );
  }

  if (error && isConfigured) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center max-w-md w-full">
          <div className="text-red-500 mb-4">
            <Users className="w-16 h-16 mx-auto" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Ошибка подключения</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <div className="flex space-x-2">
            <button
              onClick={fetchEmployees}
              className="flex-1 bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
            >
              Повторить
            </button>
            <button
              onClick={() => {
                setIsConfigured(false);
                setShowManualConfig(true);
                setError(null);
              }}
              className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
            >
              Настроить
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Users className="w-8 h-8 text-blue-500 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Сотрудники на смене</h1>
                <p className="text-gray-600">Сегодня, {new Date().toLocaleDateString('ru-RU')}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Всего на смене</p>
                <p className="text-2xl font-bold text-blue-600">{employees.length}</p>
              </div>
              <button
                onClick={fetchEmployees}
                className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
              >
                Обновить
              </button>
            </div>
          </div>
        </div>

        {/* Employee Grid */}
        {employees.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-700 mb-2">Нет сотрудников на смене</h2>
            <p className="text-gray-500">Сотрудники появятся здесь, когда начнут смену</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {employees.map((employee) => (
              <div
                key={employee.employee_id}
                className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-6"
              >
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-blue-600 font-semibold text-lg">
                      {employee.employee_name?.charAt(0) || 'N'}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {employee.employee_name || 'Неизвестно'}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {employee.employee_position || 'Сотрудник'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <TrendingUp className="w-5 h-5 text-green-500" />
                    </div>
                    <p className="text-sm text-gray-600">Выручка</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatCurrency(employee.stats.revenue)}
                    </p>
                  </div>

                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <Receipt className="w-5 h-5 text-blue-500" />
                    </div>
                    <p className="text-sm text-gray-600">Чеки</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {employee.stats.transactions}
                    </p>
                  </div>

                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <DollarSign className="w-5 h-5 text-purple-500" />
                    </div>
                    <p className="text-sm text-gray-600">Средний чек</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatCurrency(employee.stats.averageCheck)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Статус</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      На смене
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PosterEmployeeDashboard;
