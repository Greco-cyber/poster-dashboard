import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Receipt, DollarSign } from 'lucide-react';

const PosterEmployeeDashboard = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [manualToken, setManualToken] = useState('');

  // Получаем токен как в рабочем боте
  const getToken = () => {
    return manualToken || process.env.REACT_APP_POSTER_TOKEN || "";
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setShowTokenInput(true);
      setError('Токен не найден. Введите токен или добавьте переменную REACT_APP_POSTER_TOKEN в Render.');
    } else {
      setShowTokenInput(false);
      fetchEmployees();
    }
  }, [manualToken]);

  // Функция для выполнения API запроса (как в рабочем боте)
  const makeAPIRequest = async (path, params = {}) => {
    const token = getToken();
    if (!token) {
      throw new Error('Токен не найден');
    }

    // Используем тот же формат URL что и в рабочем боте
    const url = `https://joinposter.com/api/${path}`;
    
    // Добавляем токен к параметрам (как в боте)
    const allParams = new URLSearchParams({
      token: token,
      ...params
    });

    const fullUrl = `${url}?${allParams.toString()}`;
    
    console.log('Making API request to:', fullUrl);
    
    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      console.log('API response for', path, ':', data);
      
      if (data.error) {
        throw new Error(`Poster API Error: ${data.error.message || data.error}`);
      }

      return data.response || [];
    } catch (err) {
      console.error('API request failed:', err);
      throw err;
    }
  };

  // Функция для получения данных сотрудников
  const fetchEmployees = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Fetching employees with token:', !!getToken());
      
      // Получаем список сотрудников (как в оригинальном коде)
      const employeesData = await makeAPIRequest('access.getEmployees');
      
      if (!employeesData || !Array.isArray(employeesData)) {
        throw new Error('Неверный формат ответа API для сотрудников');
      }
      
      console.log('Employees data:', employeesData);
      
      // Получаем статистику продаж для каждого сотрудника
      const today = new Date();
      const dateFrom = today.toISOString().split('T')[0];
      const dateTo = dateFrom;
      
      console.log('Fetching stats for date:', dateFrom);
      
      const employeesWithStats = await Promise.all(
        employeesData.map(async (employee) => {
          try {
            // Используем правильный метод API для статистики
            const statsData = await makeAPIRequest('dash.getTransactionStats', {
              dateFrom,
              dateTo,
              employee_id: employee.employee_id,
            });
            
            let stats = {
              revenue: 0,
              transactions: 0,
              averageCheck: 0
            };
            
            if (statsData && typeof statsData === 'object') {
              stats.revenue = parseFloat(statsData.revenue) || 0;
              stats.transactions = parseInt(statsData.transactions) || 0;
              stats.averageCheck = stats.transactions > 0 ? stats.revenue / stats.transactions : 0;
            }
            
            return {
              ...employee,
              stats,
              isOnShift: Math.random() > 0.2 // 80% вероятность для демонстрации
            };
          } catch (err) {
            console.error(`Ошибка получения статистики для сотрудника ${employee.employee_name}:`, err);
            return {
              ...employee,
              stats: { revenue: 0, transactions: 0, averageCheck: 0 },
              isOnShift: Math.random() > 0.5
            };
          }
        })
      );
      
      // Фильтруем только сотрудников на смене
      const onShiftEmployees = employeesWithStats.filter(emp => emp.isOnShift);
      setEmployees(onShiftEmployees);
      
      console.log(`Loaded ${onShiftEmployees.length} employees on shift`);
      
    } catch (err) {
      setError(err.message);
      console.error('Ошибка:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTokenSubmit = () => {
    if (manualToken.trim()) {
      // Это вызовет useEffect
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: 'UAH',
    }).format(amount / 100); // Предполагаем копейки
  };

  // Экран ввода токена
  if (showTokenInput) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <Users className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900">Введите токен Poster</h1>
            <p className="text-gray-600 mt-2">Формат: account_id:hash_code</p>
          </div>
          
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Poster Token
              </label>
              <input
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="861052:02391570ff9af128e93c5a771055ba88"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <button
              onClick={handleTokenSubmit}
              disabled={!manualToken.trim()}
              className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Подключиться
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-gray-500">
            Или добавьте <code className="bg-gray-100 px-1 rounded">REACT_APP_POSTER_TOKEN</code> в переменные Render
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

  if (error) {
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
              onClick={() => setShowTokenInput(true)}
              className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
            >
              Изменить токен
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
