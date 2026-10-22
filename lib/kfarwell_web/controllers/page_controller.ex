defmodule KfarwellWeb.PageController do
  use KfarwellWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end

  def contact(conn, _params) do
    page(conn, :contact, "Contact")
  end

  def mvdwebcam_privacy(conn, _params) do
    page(conn, :mvdwebcam_privacy, "MVD Webcam Privacy Policy")
  end

  def multitunnelvpn_privacy(conn, _params) do
    page(conn, :multitunnelvpn_privacy, "MultiTunnelVPN Privacy Policy")
  end

  defp page(conn, template, title) do
    conn
    |> assign(:page_title, title)
    |> assign(:body_class, "page")
    |> render(template)
  end
end
