
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'user', 'planner');
CREATE TYPE public.paid_status AS ENUM ('unpaid', 'base_paid', 'fully_paid');
CREATE TYPE public.rsvp_status AS ENUM ('pending', 'attending', 'declined');
CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'held', 'sent', 'delivered');
CREATE TYPE public.payment_status AS ENUM ('created', 'captured', 'failed', 'refunded');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name TEXT,
  phone TEXT,
  language_pref TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Templates
CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  preview_svg TEXT,
  price_tier TEXT DEFAULT 'standard',
  tags TEXT[] DEFAULT '{}',
  language_support TEXT[] DEFAULT '{en}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  template_id UUID REFERENCES public.templates(id),
  paid_status paid_status DEFAULT 'unpaid',
  selected_features JSONB DEFAULT '{}',
  guest_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guests
CREATE TABLE public.guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  group_name TEXT,
  rsvp_status rsvp_status DEFAULT 'pending',
  rsvp_at TIMESTAMPTZ,
  people_count INTEGER DEFAULT 1,
  meal_type TEXT,
  meal_time TEXT,
  accommodation BOOLEAN DEFAULT false,
  transport BOOLEAN DEFAULT false,
  notes TEXT,
  token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Printers
CREATE TABLE public.printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact TEXT,
  api_endpoint TEXT,
  payment_terms TEXT,
  regions TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL DEFAULT 'print',
  printer_id UUID REFERENCES public.printers(id),
  status order_status DEFAULT 'pending',
  pdf_url TEXT,
  cost_printer_paise INTEGER DEFAULT 0,
  price_platform_paise INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payments
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT DEFAULT 'razorpay',
  provider_id TEXT,
  amount_paise INTEGER NOT NULL,
  status payment_status DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activity logs
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  project_id UUID REFERENCES public.projects(id),
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Security definer: role check
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Security definer: project ownership (plpgsql to avoid compile-time validation)
CREATE OR REPLACE FUNCTION public.is_project_owner(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = _user_id);
END;
$$;

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', ''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Public read active templates" ON public.templates FOR SELECT USING (active = true);
CREATE POLICY "Admins manage templates" ON public.templates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users CRUD own projects" ON public.projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Project owners manage guests" ON public.guests FOR ALL TO authenticated USING (public.is_project_owner(auth.uid(), project_id)) WITH CHECK (public.is_project_owner(auth.uid(), project_id));
CREATE POLICY "Public RSVP via token" ON public.guests FOR UPDATE TO anon USING (token IS NOT NULL) WITH CHECK (token IS NOT NULL);

CREATE POLICY "Users read own orders" ON public.orders FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects WHERE id = orders.project_id AND user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE id = orders.project_id AND user_id = auth.uid()));

CREATE POLICY "Users read own payments" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read logs" ON public.activity_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "System insert logs" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Public read active printers" ON public.printers FOR SELECT USING (active = true);
CREATE POLICY "Admins manage printers" ON public.printers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
