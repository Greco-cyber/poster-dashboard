import { useEffect, useState } from "react";

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function firstDay(date) {
  return date.slice(0, 6) + "01";
}

export default function App() {

  const [date, setDate] = useState(today());
  const [data, setData] = useState([]);

  async function load() {

    const day = await fetch(`/api/sauces-sales?dateFrom=${date}&dateTo=${date}`);
    const j = await day.json();

    setData(j.data || []);
  }

  useEffect(() => {
    load();
  }, [date]);

  return (
    <div style={{ padding: 40 }}>
      <h2>Соуси та допи</h2>

      <input
        type="date"
        value={`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}`}
        onChange={(e)=>{
          const v=e.target.value.replaceAll("-","");
          setDate(v);
        }}
      />

      <table border="1" cellPadding="10">
        <thead>
          <tr>
            <th>Співробітник</th>
            <th>Соуси</th>
            <th>Модифікатори</th>
            <th>Разом</th>
          </tr>
        </thead>

        <tbody>
          {data.map((w,i)=>(
            <tr key={i}>
              <td>{w.name}</td>
              <td>{w.sauces} ₴</td>
              <td>{w.modifiers} ₴</td>
              <td>{w.total} ₴</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
