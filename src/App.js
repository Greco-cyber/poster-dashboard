import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Receipt, DollarSign } from 'lucide-react';

const PosterEmployeeDashboard = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [apiConfig] = useState({
    token: process.env.REACT_APP_POSTER_TOKEN || '',
    account: process.env.REACT_APP_POSTER_ACCOUNT || '',
    baseUrl: process.env.REACT_APP_POSTER_BASE_URL || ''
  });
  const [isConfigured, setIsConfigured] = useState(false);

  // Проверяем конфигурацию при загрузке компонента
  useEffect(() => {
    if (apiConfig.token && apiConfig.account) {
      setIsConfigured(true);
      fetchEmployees();
    } else {
      setError('Не настроены переменные окружения. Проверьте REACT_APP_POSTER_TOKEN и REACT_APP_POSTER_ACCOUNT в настройках Render.');
    }
  }, []);

  // Функция для получения данных сотрудников
  const fetchEmployees = async () => {
    if (!apiConfig.token || !apiConfig.account) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const baseUrl = apiConfig.baseUrl || `https://${apiConfig.account}.joinposter.com/api`;
      
      // Получаем список сотрудников
      const employeesResponse = await fetch(`${baseUrl}/access.getEmployees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: apiConfig.token,
        }),
      });
      
      if (!employeesResponse.ok) {
        throw new Error('Ошибка получения данных сотрудников');
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
            const statsResponse = await fetch(`${baseUrl}/dash.getTransactionStats`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                token: apiConfig.token,
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
              isOnShift: Math.random() > 0.5 // Заглушка для определения смены
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
      setError(err.message);
      console.error('Ошибка:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: 'UAH',
    }).format(amount / 100); // Предполагаем, что API возвращает копейки
  };

  if (!isConfigured && !error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Инициализация приложения...</p>
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
          <h2 className="text-xl font-bold text-gray-900 mb-2">Ошибка конфигурации</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <div className="bg-gray-50 rounded-lg p-4 text-left">
            <h3 className="font-semibold text-gray-800 mb-2">Необходимые переменные окружения:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• <code className="bg-gray-200 px-1 rounded">REACT_APP_POSTER_TOKEN</code></li>
              <li>• <code className="bg-gray-200 px-1 rounded">REACT_APP_POSTER_ACCOUNT</code></li>
              <li>• <code className="bg-gray-200 px-1 rounded">REACT_APP_POSTER_BASE_URL</code> (опционально)</li>
            </ul>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
          >
            Перезагрузить
          </button>
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
