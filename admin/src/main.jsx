import React from 'react';
import {createRoot} from 'react-dom/client';
import AdminDashboard from './AdminDashboard';
import Kiosk from './Kiosk';
import './styles.css';
import './theme.css';
createRoot(document.getElementById('root')).render(<React.StrictMode>{window.location.pathname.startsWith('/admin')?<AdminDashboard/>:<Kiosk/>}</React.StrictMode>);
